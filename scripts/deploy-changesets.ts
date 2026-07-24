import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
const MANIFEST_PATH = join(ROOT, "dev.yaml");
const CI_TEMPLATE_PATH = join(ROOT, "scripts", "ci-template.yml");
const CHANGESETS_CONFIG_TEMPLATE_PATH = join(
  ROOT,
  "scripts",
  "changesets-config.json",
);

const CHANGESETS_CLI_VERSION = "^2.29.2";

const RELEASE_WORKFLOW = `name: Release

on:
  push:
    branches: [main]

concurrency: \${{ github.workflow }}-\${{ github.ref }}

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: "https://registry.npmjs.org"
      - run: npm install
      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          publish: npm run release
          title: "chore: version package"
          commit: "chore: version package"
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;

interface ManifestRepo {
  name?: string;
  repo: string;
}

interface ManifestPlugin {
  name: string;
  repo?: string;
}

interface Manifest {
  version: number;
  org: string;
  core: ManifestRepo;
  infrastructure: ManifestRepo[];
  plugins: ManifestPlugin[];
}

interface RepoUpdateResult {
  name: string;
  path: string;
  updated: boolean;
  skipped: boolean;
}

function logInfo(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}

function logWarn(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "warn", event, ...data }));
}

function logError(message: string, data: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", message, ...data }));
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const eqIndex = raw.indexOf("=");
      if (eqIndex !== -1) {
        flags[raw.slice(0, eqIndex)] = raw.slice(eqIndex + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[raw] = next;
          i += 1;
        } else {
          flags[raw] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function readManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return parse(raw) as Manifest;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    logInfo("dry-run", { command, args, cwd });
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Command failed (${command} ${args.join(" ")})`));
    });
  });
}

async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
  dryRun: boolean,
): Promise<string> {
  if (dryRun) {
    logInfo("dry-run", { command, args, cwd });
    return "";
  }

  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }
      rejectPromise(
        new Error(
          stderr.trim() || `Command failed (${command} ${args.join(" ")})`,
        ),
      );
    });
  });
}

function stripPublishJob(template: string): string {
  const next = template.replace(/\n\n  publish:[\s\S]*$/, "\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}

function updatePackageJson(
  repoPath: string,
  dryRun: boolean,
): { changed: boolean } {
  const packagePath = join(repoPath, "package.json");
  if (!existsSync(packagePath)) {
    logWarn("package-json-missing", { path: packagePath });
    return { changed: false };
  }
  const raw = readFileSync(packagePath, "utf-8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;

  let changed = false;
  if (!pkg.scripts || typeof pkg.scripts !== "object") {
    pkg.scripts = { release: "npm run build && changeset publish" };
    changed = true;
  } else if (!(pkg.scripts as Record<string, unknown>).release) {
    (pkg.scripts as Record<string, unknown>).release =
      "npm run build && changeset publish";
    changed = true;
  }

  if (!pkg.devDependencies || typeof pkg.devDependencies !== "object") {
    pkg.devDependencies = { "@changesets/cli": CHANGESETS_CLI_VERSION };
    changed = true;
  } else if (
    !(pkg.devDependencies as Record<string, string>)["@changesets/cli"]
  ) {
    (pkg.devDependencies as Record<string, string>)["@changesets/cli"] =
      CHANGESETS_CLI_VERSION;
    changed = true;
  }

  if (!changed) return { changed: false };

  const next = `${JSON.stringify(pkg, null, 2)}\n`;
  if (dryRun) {
    logInfo("dry-run", { action: "update-package-json", path: packagePath });
    return { changed: true };
  }
  writeFileSync(packagePath, next);
  return { changed: true };
}

function updateChangesetsConfig(
  repoPath: string,
  template: string,
  dryRun: boolean,
): { changed: boolean } {
  const changesetDir = join(repoPath, ".changeset");
  const configPath = join(changesetDir, "config.json");
  const existing = existsSync(configPath)
    ? readFileSync(configPath, "utf-8")
    : "";
  if (existing === template) return { changed: false };
  if (dryRun) {
    logInfo("dry-run", {
      action: "update-changesets-config",
      path: configPath,
    });
    return { changed: true };
  }
  if (!existsSync(changesetDir)) {
    mkdirSync(changesetDir, { recursive: true });
  }
  writeFileSync(configPath, template);
  return { changed: true };
}

function updateCiWorkflow(
  repoPath: string,
  template: string,
  dryRun: boolean,
): { changed: boolean } {
  const workflowDir = join(repoPath, ".github", "workflows");
  const workflowPath = join(workflowDir, "ci.yml");
  const existing = existsSync(workflowPath)
    ? readFileSync(workflowPath, "utf-8")
    : "";
  if (existing === template) return { changed: false };
  if (dryRun) {
    logInfo("dry-run", { action: "update-ci", path: workflowPath });
    return { changed: true };
  }
  if (!existsSync(workflowDir)) {
    mkdirSync(workflowDir, { recursive: true });
  }
  writeFileSync(workflowPath, template);
  return { changed: true };
}

function updateReleaseWorkflow(
  repoPath: string,
  dryRun: boolean,
): { changed: boolean } {
  const workflowDir = join(repoPath, ".github", "workflows");
  const workflowPath = join(workflowDir, "release.yml");
  const existing = existsSync(workflowPath)
    ? readFileSync(workflowPath, "utf-8")
    : "";
  if (existing === RELEASE_WORKFLOW) return { changed: false };
  if (dryRun) {
    logInfo("dry-run", { action: "update-release", path: workflowPath });
    return { changed: true };
  }
  if (!existsSync(workflowDir)) {
    mkdirSync(workflowDir, { recursive: true });
  }
  writeFileSync(workflowPath, RELEASE_WORKFLOW);
  return { changed: true };
}

async function commitAndPush(
  repoPath: string,
  repoName: string,
  dryRun: boolean,
): Promise<void> {
  const status = await runCommandCapture(
    "git",
    ["status", "--porcelain"],
    repoPath,
    dryRun,
  );
  if (!status) {
    logInfo("commit-skip-clean", { repo: repoName });
    return;
  }
  try {
    execSync(
      "npx prettier --write package.json .changeset/config.json .github/workflows/ci.yml .github/workflows/release.yml",
      {
        cwd: repoPath,
        stdio: "pipe",
        timeout: 30_000,
      },
    );
  } catch (_) {
    /* prettier unavailable or file missing */
  }
  await runCommand("git", ["add", "-A"], repoPath, dryRun);
  await runCommand(
    "git",
    ["commit", "-m", "chore: add changesets release workflow"],
    repoPath,
    dryRun,
  );
  await runCommand("git", ["push"], repoPath, dryRun);
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const filter = typeof flags.filter === "string" ? flags.filter : undefined;

  if (!existsSync(REPOS_DIR)) {
    throw new Error("repos/ directory not found");
  }

  const manifest = readManifest();
  const infra = manifest.infrastructure.map(
    (entry) => entry.name ?? entry.repo,
  );
  const plugins = manifest.plugins.map((entry) => entry.name);
  const repoNames = [...infra, ...plugins];
  const selected = filter
    ? repoNames.filter((name) => name === filter)
    : repoNames;

  if (filter && selected.length === 0) {
    throw new Error(`Unknown repo: ${filter}`);
  }

  const ciTemplateRaw = readFileSync(CI_TEMPLATE_PATH, "utf-8");
  const ciTemplate = stripPublishJob(ciTemplateRaw);
  const changesetsTemplate = readFileSync(
    CHANGESETS_CONFIG_TEMPLATE_PATH,
    "utf-8",
  );

  const results: RepoUpdateResult[] = [];
  for (const name of selected) {
    const repoPath = join(REPOS_DIR, name);
    if (!existsSync(repoPath)) {
      logWarn("repo-missing", { repo: name, path: repoPath });
      results.push({ name, path: repoPath, updated: false, skipped: true });
      continue;
    }
    logInfo("repo-start", { repo: name });
    const pkgResult = updatePackageJson(repoPath, dryRun);
    const changesetResult = updateChangesetsConfig(
      repoPath,
      changesetsTemplate,
      dryRun,
    );
    const ciResult = updateCiWorkflow(repoPath, ciTemplate, dryRun);
    const releaseResult = updateReleaseWorkflow(repoPath, dryRun);
    const updated =
      pkgResult.changed ||
      changesetResult.changed ||
      ciResult.changed ||
      releaseResult.changed;
    results.push({ name, path: repoPath, updated, skipped: false });
    logInfo("repo-done", { repo: name, updated });
  }

  for (const result of results) {
    if (result.skipped) continue;
    await commitAndPush(result.path, result.name, dryRun);
  }

  logInfo("deploy-summary", {
    total: results.length,
    updated: results.filter((r) => r.updated).length,
    skipped: results.filter((r) => r.skipped).length,
    dryRun,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
