import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { parseArgs } from "./lib/args.js";
import { runCommand, runCommandCapture } from "./lib/exec.js";
import { safeReadJson } from "./lib/json.js";
import { logError, logInfo, logWarn } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";
import type { Manifest, RepoUpdateResult } from "./lib/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
// Mirrors the repos' ci.yml; see the note above RELEASE_WORKFLOW.
const CI_TEMPLATE_PATH = join(ROOT, "scripts", "ci-template.yml");
const CHANGESETS_CONFIG_TEMPLATE_PATH = join(
  ROOT,
  "scripts",
  "changesets-config.json",
);

const CHANGESETS_CLI_VERSION = "^2.29.2";
const VERSION_PACKAGES_SCRIPT =
  "changeset version && npm install --package-lock-only --ignore-scripts --no-audit --no-fund";

// Templates mirror what the plugin repos run (note-properties origin/main, Nov 2026):
// scripts/ci-template.yml = .github/workflows/ci.yml, RELEASE_WORKFLOW = release.yml.
// Publishing uses npm trusted publishing (OIDC, Node 24, no NPM_TOKEN); keep them byte-identical
// to the repos' files, since updateCiWorkflow/updateReleaseWorkflow rewrite any file that differs.
// Not included: CI for changesets version PRs (they get none: GITHUB_TOKEN pushes trigger no
// workflows). `just version-pr-ci` patches it into each repo's own workflows instead.
// Caution: release.yml is rewritten to trusted publishing; a repo still publishing with NPM_TOKEN
// needs a trusted publisher configured on npmjs.com first, or its next publish fails.
const RELEASE_WORKFLOW = `name: Release

on:
  push:
    branches: [main]

concurrency: \${{ github.workflow }}-\${{ github.ref }}

jobs:
  release:
    runs-on: ubuntu-latest
    # Publishing uses npm trusted publishing: \`id-token: write\` lets the job mint the OIDC token
    # npm exchanges for a short-lived publish credential, with provenance attached. No npm
    # token is passed on purpose -- changesets/action writes one into \`.npmrc\` whenever
    # NPM_TOKEN is set, and only falls back to OIDC when it is not.
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          # Trusted publishing needs npm 11.5.1 or later, which Node 24 bundles (22 has npm 10).
          node-version: 24
          registry-url: "https://registry.npmjs.org"
      - run: npm install
      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          publish: npm run release
          version: npm run version-packages
          title: "chore: version package"
          commit: "chore: version package"
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

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
  const pkg = safeReadJson<Record<string, unknown>>(packagePath);

  let changed = false;
  if (!pkg.scripts || typeof pkg.scripts !== "object") {
    pkg.scripts = { release: "npm run build && changeset publish" };
    changed = true;
  } else if (!(pkg.scripts as Record<string, unknown>).release) {
    (pkg.scripts as Record<string, unknown>).release =
      "npm run build && changeset publish";
    changed = true;
  }

  // RELEASE_WORKFLOW runs `npm run version-packages`: version, then refresh the lockfile so the
  // version PR doesn't leave package-lock.json behind package.json.
  const scripts = pkg.scripts as Record<string, unknown>;
  if (!scripts["version-packages"]) {
    scripts["version-packages"] = VERSION_PACKAGES_SCRIPT;
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
    throw new Error(
      "repos/ directory not found. Run 'just setup' to clone workspace packages",
    );
  }

  const manifest: Manifest = readManifest();
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
