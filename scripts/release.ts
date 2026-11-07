/**
 * Release orchestration helper for the Quartz ecosystem.
 *
 *   release status [pkg...] [--offline] [--json]
 *   release plan <pkg...> [--bump patch|minor|major] [--offline] [--json]
 *   release changeset --bump <type> --summary "<text>" <pkg...> [--name <slug>] [--dry-run] [--json]
 *   release verify <pkg...> [--no-dependents] [--tasks build,typecheck,lint,test] [--timeout <s>] [--skip-doctor] [--json]
 *   release wait-npm <name>@<version> [--timeout <s>] [--interval <s>] [--json]
 *
 * Nothing here pushes, tags, merges or publishes. `changeset` writes local
 * files; `plan` prints the outward-facing commands for a human to approve.
 * `--repos-dir <path>` points every subcommand at another repos/ directory.
 */
import { join, relative, resolve } from "node:path";
import { parseArgs } from "./lib/args.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommand, runCommandCapture, TIMEOUTS } from "./lib/exec.js";
import { logError } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";
import type { Manifest } from "./lib/types.js";
import {
  buildReleaseSteps,
  collectRepoStatus,
  computeReleasePlan,
  DEFAULT_VERIFY_TASKS,
  fetchNpmInfo,
  fetchNpmInfos,
  findTurboSummary,
  formatCheckScript,
  isBumpType,
  loadWorkspacePackages,
  parsePackageSpec,
  readTurboSummary,
  resolvePackage,
  transitiveDependents,
  verdictsByPackage,
  writeChangeset,
  type BumpType,
  type LoadedPackage,
  type NpmInfo,
  type RepoReleaseStatus,
  type ReleaseStatus,
  type TaskOutcome,
} from "./lib/release/index.js";
import semver from "semver";

const ROOT = resolve(import.meta.dirname, "..");
const BOOLEAN_FLAGS = [
  "json",
  "offline",
  "dry-run",
  "no-dependents",
  "skip-doctor",
  "help",
];

class UsageError extends Error {}

interface Context {
  flags: Record<string, string | boolean>;
  args: string[];
  json: boolean;
  reposDir: string;
}

function parseCli(argv: string[]): { command: string; context: Context } {
  const { flags, positional } = parseArgs(argv);
  // parseArgs treats `--offline graph` as offline="graph"; give it back.
  const args = [...positional];
  for (const flag of BOOLEAN_FLAGS) {
    if (typeof flags[flag] === "string") {
      args.push(flags[flag] as string);
      flags[flag] = true;
    }
  }
  const command = args.shift() ?? "help";
  const reposDir =
    typeof flags["repos-dir"] === "string"
      ? resolve(process.cwd(), flags["repos-dir"])
      : join(ROOT, "repos");
  return {
    command,
    context: { flags, args, json: Boolean(flags.json), reposDir },
  };
}

function tryManifest(): Manifest | undefined {
  try {
    return readManifest();
  } catch {
    return undefined;
  }
}

function loadPackages(context: Context): LoadedPackage[] {
  return loadWorkspacePackages(context.reposDir, tryManifest());
}

function selectPackages(
  packages: LoadedPackage[],
  queries: string[],
): LoadedPackage[] {
  if (queries.length === 0) return packages;
  const unknown: string[] = [];
  const selected = new Map<string, LoadedPackage>();
  for (const query of queries) {
    const pkg = resolvePackage(packages, query) as LoadedPackage | undefined;
    if (pkg) selected.set(pkg.name, pkg);
    else unknown.push(query);
  }
  if (unknown.length > 0)
    throw new UsageError(`unknown package(s): ${unknown.join(", ")}`);
  return [...selected.values()];
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, index) => (cell ?? "").padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  console.log(format(headers));
  console.log(format(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(format(row));
}

function publishable(pkg: LoadedPackage): boolean {
  return pkg.kind === "changesets" || pkg.kind === "tag";
}

async function npmLookup(
  packages: LoadedPackage[],
  offline: boolean,
): Promise<{ results: Map<string, NpmInfo>; errors: Map<string, string> }> {
  if (offline) return { results: new Map(), errors: new Map() };
  return fetchNpmInfos(packages.filter(publishable).map((pkg) => pkg.name));
}

// --------------------------------------------------------------------------
// status
// --------------------------------------------------------------------------

const STATUS_ORDER: ReleaseStatus[] = [
  "npm-ahead",
  "dirty",
  "version-bumped-unpublished",
  "ready",
  "needs-changeset",
  "needs-version-bump",
  "lockfile-stale",
  "unknown",
  "clean",
];

function buildSummary(statuses: RepoReleaseStatus[], offline: boolean) {
  const byStatus: Partial<Record<ReleaseStatus, string[]>> = {};
  for (const status of statuses) {
    (byStatus[status.status] ??= []).push(status.repo);
  }
  const counts = Object.fromEntries(
    STATUS_ORDER.filter((status) => byStatus[status]).map((status) => [
      status,
      byStatus[status]!.length,
    ]),
  );
  const nonReleaseDirty = statuses
    .filter(
      (status) => status.dirty && status.dirtyReleasableFiles.length === 0,
    )
    .map((status) => status.repo);
  const nonReleaseDirtyFiles = [
    ...new Set(
      statuses
        .filter(
          (status) => status.dirty && status.dirtyReleasableFiles.length === 0,
        )
        .flatMap((status) =>
          status.dirtyFiles.map((file) =>
            file.includes("/") ? `${file.split("/")[0]}/` : file,
          ),
        ),
    ),
  ].sort();
  const approximate = statuses
    .filter((status) => status.releaseBase?.approximate)
    .map((status) => status.repo);
  const noBase = statuses
    .filter((status) => !status.releaseBase && status.kind !== "private")
    .map((status) => status.repo);
  const npmErrors = statuses
    .filter((status) => status.npmError)
    .map((status) => `${status.repo}: ${status.npmError}`);

  const unpushed = statuses
    .filter((status) => (status.unpushed ?? 0) > 0)
    .map((status) => `${status.repo} (${status.unpushed})`);
  const behind = statuses
    .filter((status) => (status.behind ?? 0) > 0)
    .map((status) => `${status.repo} (${status.behind})`);
  const actions: string[] = [];
  const list = (status: ReleaseStatus) => byStatus[status] ?? [];
  if (list("npm-ahead").length) {
    actions.push(
      `npm is ahead of the checkout — pull (just sync), or check whether it was published from another branch: ${list("npm-ahead").join(", ")}`,
    );
  }
  if (list("dirty").length) {
    actions.push(
      `commit or discard uncommitted source changes: ${list("dirty").join(", ")}`,
    );
  }
  if (list("version-bumped-unpublished").length) {
    actions.push(
      `bumped but not published — check their Release CI runs / tags: ${list("version-bumped-unpublished").join(", ")}`,
    );
  }
  if (list("ready").length) {
    actions.push(
      `changeset pending — push and merge the version PR: ${list("ready").join(", ")}`,
    );
  }
  const needs = [...list("needs-changeset"), ...list("needs-version-bump")];
  if (needs.length) {
    actions.push(
      `unreleased changes without a changeset/version bump: ${needs.join(", ")}`,
    );
  }
  const releasable = [
    ...needs,
    ...list("ready"),
    ...list("version-bumped-unpublished"),
  ];
  if (releasable.length) {
    actions.push(
      `plan it: pnpm tsx scripts/release.ts plan ${releasable.join(" ")}`,
    );
  }
  if (list("lockfile-stale").length) {
    actions.push("Quartz lockfile is behind npm: just update-quartz-lockfile");
  }
  if (offline) {
    actions.push(
      "offline: npm versions not checked (unpublished bumps inferred from missing git tags)",
    );
  }
  if (actions.length === 0) actions.push("everything is released and in sync");

  return {
    counts,
    byStatus,
    nonReleaseDirty: { repos: nonReleaseDirty, files: nonReleaseDirtyFiles },
    unpushed,
    behind,
    approximateReleaseBase: approximate,
    noReleaseBase: noBase,
    npmErrors,
    actions,
  };
}

async function commandStatus(context: Context): Promise<number> {
  const offline = Boolean(context.flags.offline);
  const all = loadPackages(context);
  const selected = selectPackages(all, context.args);
  const npm = await npmLookup(all, offline);

  const statuses: RepoReleaseStatus[] = [];
  const outcome = await runWithConcurrency(selected, 8, async (pkg) => {
    statuses.push(
      await collectRepoStatus(pkg, {
        info: npm.results.get(pkg.name),
        error: npm.errors.get(pkg.name),
        all: offline ? undefined : npm.results,
      }),
    );
  });
  statuses.sort((a, b) => a.repo.localeCompare(b.repo));
  const failures = outcome.failures.map(({ item, error }) => ({
    repo: item.repo,
    error: error.message,
  }));
  const summary = buildSummary(statuses, offline);

  if (context.json) {
    console.log(
      JSON.stringify({ offline, repos: statuses, failures, summary }, null, 2),
    );
    return failures.length > 0 ? 1 : 0;
  }

  printTable(
    [
      "Repo",
      "Kind",
      "Local",
      "npm",
      "Status",
      "Branch",
      "Dirty",
      "Unpushed",
      "Since",
      "Changesets",
    ],
    statuses.map((status) => [
      status.repo,
      status.kind,
      status.localVersion,
      status.npmLatest === undefined ? "-" : (status.npmLatest ?? "none"),
      status.status,
      status.branch,
      status.dirtyReleasableFiles.length
        ? `src:${status.dirtyReleasableFiles.length}`
        : status.dirty
          ? `other:${status.dirtyFiles.length}`
          : "",
      status.unpushed === null
        ? "?"
        : status.unpushed
          ? String(status.unpushed)
          : "",
      status.releaseBase
        ? `${status.releasableCommitCount}/${status.commitsSinceRelease.length}${status.releaseBase.approximate ? "~" : ""}`
        : "?",
      status.pendingChangesets
        .map((changeset) => changeset.bump ?? "?")
        .join(",") +
        (status.changesetErrors.length
          ? ` (${status.changesetErrors.length} invalid)`
          : ""),
    ]),
  );
  console.log(
    "\nSince = releasable/total commits since the last release (~ = shallow clone, base may be older).",
  );
  console.log("\nSummary:");
  console.log(
    "  " +
      Object.entries(summary.counts)
        .map(([status, count]) => `${status}: ${count}`)
        .join(", "),
  );
  for (const status of STATUS_ORDER) {
    if (status === "clean") continue;
    const repos = summary.byStatus[status];
    if (!repos?.length) continue;
    console.log(`  ${status}:`);
    for (const repo of repos) {
      const entry = statuses.find((s) => s.repo === repo)!;
      const detail =
        status === "needs-changeset" || status === "needs-version-bump"
          ? entry.commitsSinceRelease
              .filter((commit) => commit.releasable)
              .slice(0, 3)
              .map((commit) => `${commit.hash} ${commit.subject}`)
              .join("; ")
          : status === "dirty"
            ? entry.dirtyReleasableFiles.slice(0, 5).join(", ")
            : status === "lockfile-stale"
              ? (entry.staleLockEntries ?? []).join(", ")
              : status === "ready"
                ? entry.pendingChangesets
                    .map((c) => `${c.bump}: ${c.summary}`)
                    .join("; ")
                : `local ${entry.localVersion} / npm ${entry.npmLatest ?? "-"}`;
      console.log(
        `    - ${repo}: ${entry.next}${detail ? ` [${detail}]` : ""}`,
      );
    }
  }
  if (summary.nonReleaseDirty.repos.length) {
    console.log(
      `  ${summary.nonReleaseDirty.repos.length} repo(s) have only non-release local edits (${summary.nonReleaseDirty.files.slice(0, 5).join(", ")}) — ignored for release status`,
    );
  }
  if (summary.unpushed.length) {
    console.log(`  unpushed commits: ${summary.unpushed.join(", ")}`);
  }
  if (summary.behind.length) {
    console.log(
      `  behind upstream (as of last fetch): ${summary.behind.join(", ")}`,
    );
  }
  if (summary.noReleaseBase.length) {
    console.log(
      `  no release point found (no tag, version commit outside history): ${summary.noReleaseBase.join(", ")}`,
    );
  }
  for (const error of summary.npmErrors)
    console.log(`  npm lookup failed: ${error}`);
  for (const failure of failures)
    console.log(`  status failed: ${failure.repo}: ${failure.error}`);
  console.log("\nNext:");
  for (const action of summary.actions) console.log(`  - ${action}`);
  return failures.length > 0 ? 1 : 0;
}

// --------------------------------------------------------------------------
// plan
// --------------------------------------------------------------------------

function parseBump(
  value: string | boolean | undefined,
  required: boolean,
): BumpType | undefined {
  if (value === undefined) {
    if (required) throw new UsageError("--bump patch|minor|major is required");
    return undefined;
  }
  if (!isBumpType(value))
    throw new UsageError(
      `--bump must be patch, minor or major (got ${String(value)})`,
    );
  return value;
}

async function commandPlan(context: Context): Promise<number> {
  if (context.args.length === 0)
    throw new UsageError("plan needs at least one package");
  const bump = parseBump(context.flags.bump, false);
  const offline = Boolean(context.flags.offline);
  const packages = loadPackages(context);
  const npm = await npmLookup(packages, offline);
  const preAdvisories: string[] = [];
  for (const pkg of packages) {
    const latest = npm.results.get(pkg.name)?.latest;
    if (!latest || !semver.valid(latest) || !semver.valid(pkg.version))
      continue;
    if (semver.gt(pkg.version, latest)) pkg.unpublishedVersion = true;
    if (semver.lt(pkg.version, latest)) {
      preAdvisories.push(
        `${pkg.name}: npm has ${latest} but local is ${pkg.version} — pull before releasing`,
      );
    }
  }
  if (offline)
    preAdvisories.push(
      "offline: assuming every local version is already published",
    );

  const plan = computeReleasePlan(
    packages,
    context.args.map((query) => ({ query, bump })),
  );
  const npmAheadInSet = preAdvisories.filter((advisory) =>
    plan.releases.some((release) => advisory.startsWith(`${release.name}:`)),
  );
  plan.advisories.unshift(
    ...npmAheadInSet,
    ...(offline ? [preAdvisories.at(-1)!] : []),
  );
  const steps = buildReleaseSteps(plan);

  if (context.json) {
    console.log(JSON.stringify({ ...plan, steps }, null, 2));
    return 0;
  }

  console.log("Release set (dependency order):");
  printTable(
    ["Wave", "Repo", "Package", "Version", "Bump", "Why"],
    plan.releases.map((release) => [
      String(release.wave),
      release.repo,
      release.name,
      `${release.from} -> ${release.to}`,
      release.bump ?? "(already bumped)",
      [
        ...release.reasons.map((reason) =>
          reason === "requested" ? "requested" : "range",
        ),
        release.triggeredBy.length ? `by ${release.triggeredBy.join(",")}` : "",
        release.hasPendingChangeset ? "changeset pending" : "",
      ]
        .filter(Boolean)
        .join(" "),
    ]),
  );
  if (plan.affected.length) {
    const names = [...new Set(plan.affected.map((entry) => entry.repo))];
    console.log(
      `\nIn-range dependents (no release needed, picked up via caret; covered by verify): ${names.length}`,
    );
    console.log(`  ${names.join(", ")}`);
  }
  if (plan.consumerUpdates.length) {
    console.log("\nConsumer range edits:");
    for (const consumer of plan.consumerUpdates) {
      for (const update of consumer.rangeUpdates) {
        console.log(
          `  ${consumer.repo}: ${update.dependency} ${update.from} -> ${update.to}`,
        );
      }
    }
  }
  if (plan.advisories.length) {
    console.log("\nAdvisories:");
    for (const advisory of plan.advisories) console.log(`  - ${advisory}`);
  }
  console.log(
    "\nSteps ([ASK] = outward-facing: get human approval first; waves gate each other):",
  );
  let wave = -1;
  for (const step of steps) {
    if (step.wave !== wave) {
      wave = step.wave;
      console.log(`  -- wave ${wave} --`);
    }
    const tag =
      step.kind === "outward"
        ? "[ASK]  "
        : step.kind === "network"
          ? "[NET]  "
          : "[LOCAL]";
    console.log(`  ${String(step.index).padStart(2)}. ${tag} ${step.command}`);
    console.log(`             ${step.description}`);
  }
  return 0;
}

// --------------------------------------------------------------------------
// changeset
// --------------------------------------------------------------------------

async function commandChangeset(context: Context): Promise<number> {
  const bump = parseBump(context.flags.bump, true)!;
  const summary =
    typeof context.flags.summary === "string" ? context.flags.summary : "";
  if (!summary.trim()) throw new UsageError('--summary "<text>" is required');
  if (context.args.length === 0)
    throw new UsageError("changeset needs at least one package");
  const dryRun = Boolean(context.flags["dry-run"]);
  const name =
    typeof context.flags.name === "string" ? context.flags.name : undefined;
  const packages = selectPackages(loadPackages(context), context.args);

  const refusals: string[] = [];
  for (const pkg of packages) {
    if (pkg.kind === "private")
      refusals.push(`${pkg.repo}: private package, never released`);
    else if (!pkg.hasChangesetDir) {
      refusals.push(
        `${pkg.repo}: no .changeset directory (releases via ${pkg.kind}, not changesets)`,
      );
    }
  }
  if (refusals.length > 0) {
    throw new Error(
      `refusing to write changesets:\n  ${refusals.join("\n  ")}`,
    );
  }

  const written = packages.map((pkg) => {
    const result = writeChangeset({
      repoPath: pkg.path,
      packageName: pkg.name,
      bump,
      summary,
      name,
      dryRun,
    });
    return {
      repo: pkg.repo,
      name: pkg.name,
      ...result,
      path: relative(process.cwd(), result.path).startsWith("..")
        ? result.path
        : relative(process.cwd(), result.path),
    };
  });

  if (context.json) {
    console.log(JSON.stringify({ dryRun, changesets: written }, null, 2));
    return 0;
  }
  for (const entry of written) {
    console.log(`${dryRun ? "[dry-run] would write" : "wrote"} ${entry.path}`);
    if (dryRun) console.log(entry.content.replace(/^/gm, "    "));
  }
  if (!dryRun) {
    console.log(
      `\nNext: just commit <repo> "chore: add changeset" for each (${written.map((entry) => entry.repo).join(", ")})`,
    );
  }
  return 0;
}

// --------------------------------------------------------------------------
// verify
// --------------------------------------------------------------------------

async function runCapturedOrInherited(
  json: boolean,
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ ok: boolean; output: string }> {
  try {
    if (json) {
      const output = await runCommandCapture(command, args, cwd, false, {
        timeout,
      });
      return { ok: true, output };
    }
    await runCommand(command, args, cwd, false, { timeout });
    return { ok: true, output: "" };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

async function commandVerify(context: Context): Promise<number> {
  if (context.args.length === 0)
    throw new UsageError("verify needs at least one package");
  const all = loadPackages(context);
  const targets = selectPackages(all, context.args);
  const names = new Set(targets.map((pkg) => pkg.name));
  const dependents = context.flags["no-dependents"]
    ? new Set<string>()
    : transitiveDependents(all, names);
  const scope = [...names, ...dependents].sort();
  const tasks =
    typeof context.flags.tasks === "string"
      ? context.flags.tasks
          .split(",")
          .map((task) => task.trim())
          .filter(Boolean)
      : [...DEFAULT_VERIFY_TASKS];
  const timeout =
    typeof context.flags.timeout === "string" &&
    Number(context.flags.timeout) > 0
      ? Number(context.flags.timeout) * 1000
      : TIMEOUTS.TURBO_BUILD;

  if (!context.json) {
    console.log(
      `Verifying ${names.size} package(s) + ${dependents.size} dependent(s): ${tasks.join(", ")}`,
    );
  }

  const started = Date.now();
  const turboArgs = [
    "turbo",
    "run",
    ...tasks,
    ...scope.map((name) => `--filter=${name}`),
    "--continue",
    "--summarize",
    "--output-logs=errors-only",
  ];
  const turbo = await runCapturedOrInherited(
    context.json,
    "pnpm",
    turboArgs,
    ROOT,
    timeout,
  );
  const summaryPath = findTurboSummary(ROOT, started);
  const taskResults = summaryPath ? readTurboSummary(summaryPath) : [];
  const verdicts = new Map(
    verdictsByPackage(taskResults).map((verdict) => [verdict.name, verdict]),
  );

  // Formatting: run each repo's non-writing check script directly.
  const scoped = all.filter((pkg) => scope.includes(pkg.name));
  await runWithConcurrency(scoped, 4, async (pkg) => {
    const script = formatCheckScript(
      pkg.packageJson.scripts as Record<string, string> | undefined,
    );
    const verdict = verdicts.get(pkg.name) ?? {
      name: pkg.name,
      ok: true,
      tasks: {} as Record<string, TaskOutcome>,
    };
    if (!script) {
      verdicts.set(pkg.name, verdict);
      return;
    }
    try {
      await runCommandCapture("pnpm", ["run", script], pkg.path, false, {
        timeout: 120_000,
      });
      verdict.tasks.format = "pass";
    } catch {
      verdict.tasks.format = "fail";
      verdict.ok = false;
    }
    verdicts.set(pkg.name, verdict);
  });

  let doctor: { ok: boolean; results?: unknown; error?: string } | undefined;
  if (!context.flags["skip-doctor"] && !context.flags["repos-dir"]) {
    const result = await runCapturedOrInherited(
      true,
      "pnpm",
      ["tsx", "scripts/doctor.ts", "--skip-network", "--json"],
      ROOT,
      120_000,
    );
    const start = result.output.indexOf("{");
    const end = result.output.lastIndexOf("}");
    try {
      const parsed = JSON.parse(result.output.slice(start, end + 1)) as {
        ok: boolean;
        results: unknown;
      };
      doctor = { ok: parsed.ok, results: parsed.results };
    } catch {
      doctor = { ok: false, error: result.output.slice(0, 2000) };
    }
  }

  const rows = [...verdicts.values()]
    .filter((verdict) => scope.includes(verdict.name) || !verdict.ok)
    .sort(
      (a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name),
    );
  const ok = turbo.ok && rows.every((row) => row.ok) && (doctor?.ok ?? true);
  const turboFailure =
    !turbo.ok && !summaryPath ? turbo.output.slice(-4000) : undefined;

  if (context.json) {
    console.log(
      JSON.stringify(
        {
          ok,
          packages: [...names],
          dependents: [...dependents],
          tasks,
          turbo: { ok: turbo.ok, summary: summaryPath, error: turboFailure },
          results: rows,
          doctor,
        },
        null,
        2,
      ),
    );
    return ok ? 0 : 1;
  }

  const columns = [...tasks, "format"];
  console.log("");
  printTable(
    ["Package", "Result", ...columns],
    rows.map((row) => [
      row.name,
      row.ok ? "PASS" : "FAIL",
      ...columns.map((task) => row.tasks[task] ?? "-"),
    ]),
  );
  if (turboFailure)
    console.log(`\nturbo failed before producing a summary:\n${turboFailure}`);
  if (doctor) {
    console.log(
      `\ndoctor (offline lockfile/peer checks): ${doctor.ok ? "PASS" : "FAIL"}`,
    );
    for (const result of (doctor.results as
      Array<{ name: string; ok: boolean; details: string[] }> | undefined) ??
      []) {
      if (result.ok) continue;
      console.log(`  FAIL ${result.name}`);
      for (const detail of result.details.slice(0, 10))
        console.log(`    - ${detail}`);
    }
    if (doctor.error) console.log(`  ${doctor.error}`);
  }
  console.log(
    `\n${ok ? "PASS" : "FAIL"}: ${rows.filter((row) => !row.ok).length} package(s) failing`,
  );
  console.log(
    "('ignored' = known workspace-only failure, excluded in workspace CI; '-' = no such script)",
  );
  return ok ? 0 : 1;
}

// --------------------------------------------------------------------------
// wait-npm
// --------------------------------------------------------------------------

async function commandWaitNpm(context: Context): Promise<number> {
  if (context.args.length === 0)
    throw new UsageError("wait-npm needs <name>@<version>");
  let specs: Array<{ name: string; version: string }>;
  try {
    specs = context.args.map(parsePackageSpec);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const timeoutMs =
    (Number(context.flags.timeout) > 0 ? Number(context.flags.timeout) : 900) *
    1000;
  const intervalMs =
    (Number(context.flags.interval) > 0 ? Number(context.flags.interval) : 15) *
    1000;
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(specs.map((spec) => `${spec.name}@${spec.version}`));
  while (pending.size > 0) {
    for (const spec of specs) {
      const key = `${spec.name}@${spec.version}`;
      if (!pending.has(key)) continue;
      try {
        const info = await fetchNpmInfo(spec.name);
        if (info.versions.includes(spec.version)) {
          pending.delete(key);
          if (!context.json) console.log(`published: ${key}`);
        }
      } catch (error) {
        if (!context.json)
          console.log(`lookup failed for ${key}: ${(error as Error).message}`);
      }
    }
    if (pending.size === 0) break;
    if (Date.now() + intervalMs > deadline) break;
    if (!context.json) console.log(`waiting for: ${[...pending].join(", ")}`);
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, intervalMs),
    );
  }
  const ok = pending.size === 0;
  if (context.json)
    console.log(JSON.stringify({ ok, missing: [...pending] }, null, 2));
  else if (!ok)
    console.log(`timed out waiting for: ${[...pending].join(", ")}`);
  return ok ? 0 : 1;
}

// --------------------------------------------------------------------------

const USAGE = `Usage: pnpm tsx scripts/release.ts <command> [options]

  status [pkg...] [--offline]             release state of every repo + what to do next
  plan <pkg...> [--bump patch|minor|major] release set in dependency order with exact steps
  changeset --bump <type> --summary "<text>" <pkg...> [--name <slug>] [--dry-run]
  verify <pkg...> [--no-dependents] [--tasks a,b] [--timeout <s>] [--skip-doctor]
  wait-npm <name>@<version>... [--timeout <s>] [--interval <s>]

All commands accept --json and --repos-dir <path>. Nothing here pushes, tags or publishes.`;

async function main(): Promise<number> {
  const { command, context } = parseCli(process.argv.slice(2));
  switch (command) {
    case "status":
      return commandStatus(context);
    case "plan":
      return commandPlan(context);
    case "changeset":
      return commandChangeset(context);
    case "verify":
      return commandVerify(context);
    case "wait-npm":
      return commandWaitNpm(context);
    case "help":
      console.log(USAGE);
      return 0;
    default:
      throw new UsageError(`unknown command: ${command}`);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logError(message, {
        usage: error instanceof UsageError ? USAGE : undefined,
      });
      process.exit(error instanceof UsageError ? 2 : 1);
    });
}
