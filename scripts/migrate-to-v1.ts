import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import semver from "semver";
import { parseArgs } from "./lib/args.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommandCapture, TIMEOUTS } from "./lib/exec.js";
import { safeReadJson } from "./lib/json.js";
import { logError, logInfo } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";
import {
  computeReleaseWaves,
  DEPENDENCY_SECTIONS,
  rewriteInternalRanges,
  TARGET_RANGE,
  TARGET_VERSION,
} from "./lib/migrate-v1.js";
import type { MigrationPackageJson, RangeRewrite } from "./lib/migrate-v1.js";
import { checkPackageVersionPresence } from "./lib/registry.js";
import type { RepoUpdateResult } from "./lib/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
const CHANGELOG_ENTRY = `## 1.0.0

### Major Changes

- Stable 1.0 release. All \`@quartz-community/*\` dependencies now use \`^1.0.0\` ranges.

  Pre-1.0 caret ranges pinned the minor version (\`^0.2.1\` means \`>=0.2.1 <0.3.0\`), so
  published fixes to shared packages could never be resolved by dependents. Moving the
  ecosystem to 1.0 makes caret ranges behave conventionally.
`;

type Mode = "plan" | "apply-local" | "verify";

interface RepoRecord {
  directory: string;
  path: string;
  packagePath: string;
  packageJson: MigrationPackageJson;
  name: string;
}

interface MigrationRepoResult extends RepoUpdateResult {
  packageName: string;
  packageChanged: boolean;
  changelogChanged: boolean;
  oldVersion?: string;
  newVersion?: string;
  rewrites: RangeRewrite[];
  packageOutput: string;
  changelogPath?: string;
  changelogOutput?: string;
  changelogExisted: boolean;
}

interface MigrationPlan {
  waves: string[][];
  repos: MigrationRepoResult[];
  totals: {
    packages: number;
    waves: number;
    repositories: number;
    files: number;
    versionBumps: number;
    rangeRewrites: number;
    changelogs: number;
  };
}

interface VerificationCheck {
  name: string;
  ok: boolean;
  summary: string;
  details: string[];
}

interface VerificationReport {
  checks: VerificationCheck[];
  ok: boolean;
}

function parseMode(argv: string[]): { mode: Mode; json: boolean } {
  const { flags, positional } = parseArgs(argv);
  const allowed = new Set(["plan", "apply-local", "verify", "json"]);
  const unknown = Object.keys(flags).filter((flag) => !allowed.has(flag));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown flag(s): ${unknown.map((flag) => `--${flag}`).join(", ")}`,
    );
  }
  if (positional.length > 0) {
    throw new Error(
      `Unexpected positional argument(s): ${positional.join(", ")}`,
    );
  }

  for (const flag of Object.keys(flags)) {
    if (flags[flag] !== true) {
      throw new Error(`Flag --${flag} does not accept a value`);
    }
  }

  const modes = (["plan", "apply-local", "verify"] as const).filter(
    (mode) => flags[mode] === true,
  );
  if (modes.length > 1) {
    throw new Error(
      `Modes are mutually exclusive: ${modes.map((mode) => `--${mode}`).join(", ")}`,
    );
  }

  return { mode: modes[0] ?? "plan", json: flags.json === true };
}

function discoverRepositories(): {
  scoped: RepoRecord[];
  quartz: RepoRecord;
} {
  if (!existsSync(REPOS_DIR)) {
    throw new Error("repos/ directory not found. Run 'just setup' first");
  }

  const manifest = readManifest();
  const coreDirectory = basename(manifest.core.repo);
  const records: RepoRecord[] = [];
  for (const entry of readdirSync(REPOS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packagePath = join(REPOS_DIR, entry.name, "package.json");
    if (!existsSync(packagePath)) continue;
    const packageJson = safeReadJson<MigrationPackageJson>(packagePath);
    if (typeof packageJson.name !== "string") continue;
    records.push({
      directory: entry.name,
      path: join(REPOS_DIR, entry.name),
      packagePath,
      packageJson,
      name: packageJson.name,
    });
  }

  const scoped = records
    .filter((record) => record.name.startsWith("@quartz-community/"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const duplicateNames = scoped
    .filter(
      (record, index) =>
        scoped.findIndex((candidate) => candidate.name === record.name) !==
        index,
    )
    .map((record) => record.name);
  if (duplicateNames.length > 0) {
    throw new Error(
      `Duplicate package names: ${[...new Set(duplicateNames)].join(", ")}`,
    );
  }

  const quartz = records.find(
    (record) =>
      record.directory === coreDirectory && record.name === "@jackyzha0/quartz",
  );
  if (!quartz) {
    throw new Error(`Quartz core package not found in repos/${coreDirectory}`);
  }
  if (quartz.packageJson.private !== true) {
    throw new Error("@jackyzha0/quartz must remain private");
  }
  if (scoped.length === 0) {
    throw new Error("No @quartz-community/* packages found in repos/");
  }

  return { scoped, quartz };
}

function buildGraph(records: RepoRecord[]): Map<string, Set<string>> {
  const names = new Set(records.map((record) => record.name));
  const graph = new Map<string, Set<string>>();
  for (const record of records) {
    const dependencies = new Set<string>();
    for (const section of [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      for (const dependency of Object.keys(record.packageJson[section] ?? {})) {
        if (names.has(dependency)) dependencies.add(dependency);
      }
    }
    graph.set(record.name, dependencies);
  }
  return graph;
}

function prependChangelog(existing: string): string {
  if (/^## 1\.0\.0$/m.test(existing)) return existing;
  const normalized = existing.replace(/^\s+|\s+$/g, "");
  if (!normalized) return CHANGELOG_ENTRY;

  const lines = normalized.split("\n");
  if (lines[0].startsWith("# ")) {
    const heading = lines.shift()!;
    const remainder = lines.join("\n").replace(/^\s+/, "");
    return `${heading}\n\n${CHANGELOG_ENTRY}${remainder ? `\n${remainder}\n` : ""}`;
  }
  return `${CHANGELOG_ENTRY}\n${normalized}\n`;
}

function createRepoResult(
  record: RepoRecord,
  bumpVersion: boolean,
): MigrationRepoResult {
  const rewritten = rewriteInternalRanges(record.packageJson);
  const packageJson = rewritten.packageJson;
  let oldVersion: string | undefined;
  let newVersion: string | undefined;

  if (bumpVersion) {
    if (
      typeof packageJson.version !== "string" ||
      !semver.valid(packageJson.version)
    ) {
      throw new Error(
        `${record.name} has invalid version: ${String(packageJson.version)}`,
      );
    }
    if (semver.gt(packageJson.version, TARGET_VERSION)) {
      throw new Error(
        `${record.name}@${packageJson.version} is newer than target ${TARGET_VERSION}`,
      );
    }
    oldVersion = packageJson.version;
    newVersion = TARGET_VERSION;
    packageJson.version = TARGET_VERSION;
  }

  const packageOutput = `${JSON.stringify(packageJson, null, 2)}\n`;
  const currentPackageOutput = readFileSync(record.packagePath, "utf-8");
  const packageChanged = packageOutput !== currentPackageOutput;
  const changelogPath = bumpVersion
    ? join(record.path, "CHANGELOG.md")
    : undefined;
  const changelogExisted = changelogPath ? existsSync(changelogPath) : false;
  const currentChangelog = changelogExisted
    ? readFileSync(changelogPath!, "utf-8")
    : "";
  const changelogOutput = bumpVersion
    ? prependChangelog(currentChangelog)
    : undefined;
  const changelogChanged =
    changelogOutput !== undefined && changelogOutput !== currentChangelog;
  const updated = packageChanged || changelogChanged;

  return {
    name: record.directory,
    packageName: record.name,
    path: record.path,
    updated,
    skipped: false,
    packageChanged,
    changelogChanged,
    oldVersion,
    newVersion,
    rewrites: rewritten.rewrites,
    packageOutput,
    changelogPath,
    changelogOutput,
    changelogExisted,
  };
}

function createPlan(scoped: RepoRecord[], quartz: RepoRecord): MigrationPlan {
  const waves = computeReleaseWaves(buildGraph(scoped));
  const recordsByName = new Map(scoped.map((record) => [record.name, record]));
  const orderedRecords = waves.flatMap((wave) =>
    wave.map((name) => {
      const record = recordsByName.get(name);
      if (!record) throw new Error(`Missing repository record for ${name}`);
      return record;
    }),
  );
  const repos = [
    ...orderedRecords.map((record) => createRepoResult(record, true)),
    createRepoResult(quartz, false),
  ];

  return {
    waves,
    repos,
    totals: {
      packages: scoped.length,
      waves: waves.length,
      repositories: repos.length,
      files: repos.reduce(
        (total, repo) =>
          total + Number(repo.packageChanged) + Number(repo.changelogChanged),
        0,
      ),
      versionBumps: repos.filter(
        (repo) =>
          repo.oldVersion !== undefined && repo.oldVersion !== repo.newVersion,
      ).length,
      rangeRewrites: repos.reduce(
        (total, repo) => total + repo.rewrites.length,
        0,
      ),
      changelogs: repos.filter((repo) => repo.changelogChanged).length,
    },
  };
}

function printPlan(plan: MigrationPlan): void {
  console.log("Release waves");
  console.log("=============");
  plan.waves.forEach((wave, index) => {
    console.log(`Wave ${index + 1} (${wave.length} packages)`);
    for (const name of wave) console.log(`  - ${name}`);
  });

  console.log("\nIntended changes");
  console.log("================");
  for (const repo of plan.repos) {
    console.log(`\n${repo.name} (${repo.packageName})`);
    if (repo.packageChanged) {
      console.log("  package.json");
      if (
        repo.oldVersion !== undefined &&
        repo.oldVersion !== repo.newVersion
      ) {
        console.log(`    - version: ${repo.oldVersion}`);
        console.log(`    + version: ${repo.newVersion}`);
      }
      for (const rewrite of repo.rewrites) {
        console.log(
          `    - ${rewrite.section}.${rewrite.dependency}: ${rewrite.from}`,
        );
        console.log(
          `    + ${rewrite.section}.${rewrite.dependency}: ${rewrite.to}`,
        );
      }
    }
    if (repo.changelogChanged) {
      console.log(
        `  CHANGELOG.md (${repo.changelogExisted ? "prepend" : "create"})`,
      );
      for (const line of CHANGELOG_ENTRY.trimEnd().split("\n")) {
        console.log(`    + ${line}`);
      }
    }
    if (!repo.updated) console.log("  (no changes)");
  }

  console.log("\nTotals");
  console.log("======");
  console.log(`Packages to release: ${plan.totals.packages}`);
  console.log(`Release waves: ${plan.totals.waves}`);
  console.log(`Repositories updated: ${plan.totals.repositories}`);
  console.log(`Files changed: ${plan.totals.files}`);
  console.log(`Version bumps: ${plan.totals.versionBumps}`);
  console.log(`Range rewrites: ${plan.totals.rangeRewrites}`);
  console.log(`Changelog updates: ${plan.totals.changelogs}`);
  console.log("Mode: plan (no files written)");
}

function applyPlan(plan: MigrationPlan): void {
  const results: RepoUpdateResult[] = [];
  for (const repo of plan.repos) {
    if (repo.packageChanged) {
      writeFileSync(join(repo.path, "package.json"), repo.packageOutput);
      logInfo("migration-file-written", {
        repo: repo.name,
        path: "package.json",
      });
    }
    if (repo.changelogChanged && repo.changelogPath && repo.changelogOutput) {
      writeFileSync(repo.changelogPath, repo.changelogOutput);
      logInfo("migration-file-written", {
        repo: repo.name,
        path: "CHANGELOG.md",
      });
    }
    results.push({
      name: repo.name,
      path: repo.path,
      updated: repo.updated,
      skipped: repo.skipped,
    });
  }
  logInfo("migration-summary", {
    mode: "apply-local",
    total: results.length,
    updated: results.filter((result) => result.updated).length,
    skipped: results.filter((result) => result.skipped).length,
    gitOperations: false,
    publishing: false,
  });
}

function statusPath(line: string): string {
  const path = line.slice(3);
  const renameSeparator = path.lastIndexOf(" -> ");
  return renameSeparator >= 0 ? path.slice(renameSeparator + 4) : path;
}

async function collectGitOutput(
  records: RepoRecord[],
  args: string[],
): Promise<{ output: Map<string, string>; failures: string[] }> {
  const output = new Map<string, string>();
  const result = await runWithConcurrency(records, 8, async (record) => {
    output.set(
      record.name,
      await runCommandCapture("git", args, record.path, false, {
        timeout: TIMEOUTS.GIT_OP,
      }),
    );
  });
  return {
    output,
    failures: result.failures.map(
      ({ item, error }) => `${item.name}: ${error.message}`,
    ),
  };
}

async function verifyNotPublished(
  scoped: RepoRecord[],
): Promise<VerificationCheck> {
  const presence = await checkPackageVersionPresence(
    scoped.map((record) => record.name),
    TARGET_VERSION,
  );
  const details = presence.flatMap((result) => {
    if (result.error) return [`${result.name}: ${result.error}`];
    if (result.published)
      return [`${result.name}@${TARGET_VERSION} is already published`];
    return [];
  });
  return {
    name: "Not already published",
    ok: details.length === 0,
    summary:
      details.length === 0
        ? `${presence.length} packages checked; ${TARGET_VERSION} is absent from npm`
        : `${details.length} registry check(s) failed`,
    details,
  };
}

async function verifyCleanish(
  records: RepoRecord[],
): Promise<VerificationCheck> {
  const statuses = await collectGitOutput(records, ["status", "--porcelain"]);
  const details = [...statuses.failures];
  for (const record of records) {
    const status = statuses.output.get(record.name) ?? "";
    for (const line of status.split("\n").filter(Boolean)) {
      const path = statusPath(line);
      const unsafe =
        path === "package.json" ||
        path === "CHANGELOG.md" ||
        path.startsWith("src/") ||
        path.startsWith("test/") ||
        path.startsWith("tests/");
      if (unsafe) details.push(`${record.name}: ${line}`);
    }
  }
  return {
    name: "Clean-ish tree",
    ok: details.length === 0,
    summary:
      details.length === 0
        ? `${records.length} repos have no package, changelog, source, or test changes (.gitignore tolerated)`
        : `${details.length} unsafe working-tree change(s) found`,
    details,
  };
}

async function verifyBranches(
  records: RepoRecord[],
): Promise<VerificationCheck> {
  const details: string[] = [];
  let checked = 0;
  const withConfig = records.filter((record) => {
    const configPath = join(record.path, ".changeset", "config.json");
    if (existsSync(configPath)) return true;
    if (record.name === "@jackyzha0/quartz") {
      details.push(
        `${record.name}: no .changeset/config.json; branch check skipped`,
      );
      return false;
    }
    details.push(`${record.name}: missing .changeset/config.json`);
    return false;
  });
  const branches = await collectGitOutput(withConfig, [
    "branch",
    "--show-current",
  ]);
  const failures = [...branches.failures];

  for (const record of withConfig) {
    const config = safeReadJson<{ baseBranch?: string }>(
      join(record.path, ".changeset", "config.json"),
    );
    if (!config.baseBranch) {
      failures.push(`${record.name}: changesets baseBranch is missing`);
      continue;
    }
    checked += 1;
    const branch = branches.output.get(record.name);
    if (branch !== config.baseBranch) {
      failures.push(
        `${record.name}: current branch ${branch || "(detached)"}, expected ${config.baseBranch}`,
      );
    }
  }

  return {
    name: "Correct branch",
    ok: failures.length === 0,
    summary:
      failures.length === 0
        ? `${checked} changeset repos match baseBranch; Quartz core has no changesets config`
        : `${failures.length} branch/config mismatch(es) found`,
    details: [...failures, ...details],
  };
}

function verifyPendingChangesets(records: RepoRecord[]): VerificationCheck {
  const details: string[] = [];
  let checked = 0;
  for (const record of records) {
    const changesetDirectory = join(record.path, ".changeset");
    if (!existsSync(changesetDirectory)) {
      if (record.name === "@jackyzha0/quartz") {
        details.push(`${record.name}: no .changeset directory; skipped`);
      } else {
        details.push(`${record.name}: missing .changeset directory`);
      }
      continue;
    }
    checked += 1;
    for (const entry of readdirSync(changesetDirectory, {
      withFileTypes: true,
    })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        details.push(`${record.name}: .changeset/${entry.name}`);
      }
    }
  }
  const failures = details.filter((detail) => !detail.endsWith("; skipped"));
  return {
    name: "No pending changesets",
    ok: failures.length === 0,
    summary:
      failures.length === 0
        ? `${checked} changeset directories checked; no unreleased markdown files`
        : `${failures.length} pending/missing changeset issue(s) found`,
    details,
  };
}

function verifyPostEditConsistency(plan: MigrationPlan): VerificationCheck {
  const details: string[] = [];
  let checkedRanges = 0;
  for (const repo of plan.repos) {
    const packageJson = safeReadJson<MigrationPackageJson>(
      join(repo.path, "package.json"),
    );
    const postEdit = rewriteInternalRanges(packageJson).packageJson;
    if (repo.packageName.startsWith("@quartz-community/")) {
      postEdit.version = TARGET_VERSION;
    }
    if (
      repo.packageName.startsWith("@quartz-community/") &&
      postEdit.version !== TARGET_VERSION
    ) {
      details.push(
        `${repo.packageName}: version would not be ${TARGET_VERSION}`,
      );
    }
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [dependency, range] of Object.entries(
        postEdit[section] ?? {},
      )) {
        if (!dependency.startsWith("@quartz-community/")) continue;
        checkedRanges += 1;
        if (range !== TARGET_RANGE) {
          details.push(
            `${repo.packageName}: ${section}.${dependency} is ${range}`,
          );
        }
      }
    }
  }
  return {
    name: "Post-edit range consistency",
    ok: details.length === 0,
    summary:
      details.length === 0
        ? `${checkedRanges} internal ranges resolve to ${TARGET_RANGE} in the planned post-edit state`
        : `${details.length} inconsistent post-edit range(s) found`,
    details,
  };
}

async function runVerification(
  scoped: RepoRecord[],
  quartz: RepoRecord,
  plan: MigrationPlan,
): Promise<VerificationReport> {
  const records = [...scoped, quartz];
  const checks: VerificationCheck[] = [];
  checks.push(await verifyNotPublished(scoped));
  checks.push(await verifyCleanish(records));
  checks.push(await verifyBranches(records));
  checks.push(verifyPendingChangesets(records));
  checks.push(verifyPostEditConsistency(plan));
  return { checks, ok: checks.every((check) => check.ok) };
}

function printVerification(report: VerificationReport): void {
  console.log("Migration verification");
  console.log("======================");
  for (const check of report.checks) {
    console.log(
      `[${check.ok ? "PASS" : "FAIL"}] ${check.name}: ${check.summary}`,
    );
    for (const detail of check.details) console.log(`  - ${detail}`);
  }
  console.log(
    `Overall: ${report.ok ? "PASS" : "FAIL"} (${report.checks.filter((check) => check.ok).length}/${report.checks.length} checks passed)`,
  );
}

async function main(): Promise<void> {
  const { mode, json } = parseMode(process.argv.slice(2));
  const { scoped, quartz } = discoverRepositories();
  const plan = createPlan(scoped, quartz);

  if (mode === "plan") {
    if (json) console.log(JSON.stringify({ mode, ...plan }, null, 2));
    else printPlan(plan);
    return;
  }

  if (mode === "apply-local") {
    if (json) {
      throw new Error("--json is not supported with --apply-local");
    }
    applyPlan(plan);
    return;
  }

  const report = await runVerification(scoped, quartz, plan);
  if (json) console.log(JSON.stringify({ mode, ...report }, null, 2));
  else printVerification(report);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exitCode = 1;
});
