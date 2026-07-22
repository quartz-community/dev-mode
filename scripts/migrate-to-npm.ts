import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
const MANIFEST_PATH = join(ROOT, "dev.yaml");
const CI_TEMPLATE_PATH = join(ROOT, "scripts", "ci-template.yml");

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

const versionCache = new Map<string, string | null>();

function getPackageVersion(name: string): string | null {
  if (versionCache.has(name)) return versionCache.get(name) ?? null;
  const packagePath = join(REPOS_DIR, name, "package.json");
  if (!existsSync(packagePath)) {
    logWarn("dependency-missing", { name, path: packagePath });
    versionCache.set(name, null);
    return null;
  }
  try {
    const raw = readFileSync(packagePath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    if (!pkg.version) {
      logWarn("dependency-version-missing", { name, path: packagePath });
      versionCache.set(name, null);
      return null;
    }
    versionCache.set(name, pkg.version);
    return pkg.version;
  } catch (error) {
    logWarn("dependency-version-error", {
      name,
      path: packagePath,
      error: error instanceof Error ? error.message : String(error),
    });
    versionCache.set(name, null);
    return null;
  }
}

function rewriteDependencyBlock(block: Record<string, string> | undefined): {
  updated: boolean;
  block: Record<string, string> | undefined;
} {
  if (!block) return { updated: false, block };
  let updated = false;
  const entries = Object.entries(block);
  for (const [dep, spec] of entries) {
    const match = /^github:quartz-community\/([^#]+)(?:#.+)?$/.exec(spec);
    if (!match) continue;
    const targetName = match[1];
    const version = getPackageVersion(targetName);
    if (!version) {
      logWarn("dependency-version-unresolved", {
        dep,
        spec,
        target: targetName,
      });
      continue;
    }
    const newName = `@quartz-community/${targetName}`;
    const newSpec = `^${version}`;
    if (dep !== newName) {
      delete block[dep];
      block[newName] = newSpec;
      updated = true;
      continue;
    }
    if (block[dep] !== newSpec) {
      block[dep] = newSpec;
      updated = true;
    }
  }
  return { updated, block };
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
  if (!pkg.publishConfig || typeof pkg.publishConfig !== "object") {
    pkg.publishConfig = { access: "public" };
    changed = true;
  } else if (!(pkg.publishConfig as Record<string, unknown>).access) {
    (pkg.publishConfig as Record<string, unknown>).access = "public";
    changed = true;
  }

  if (!pkg.scripts || typeof pkg.scripts !== "object") {
    pkg.scripts = { prepublishOnly: "npm run build" };
    changed = true;
  } else if (!(pkg.scripts as Record<string, unknown>).prepublishOnly) {
    (pkg.scripts as Record<string, unknown>).prepublishOnly = "npm run build";
    changed = true;
  }

  const dependencyBlocks = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  for (const blockName of dependencyBlocks) {
    const block = pkg[blockName] as Record<string, string> | undefined;
    const result = rewriteDependencyBlock(block);
    if (result.updated) {
      pkg[blockName] = result.block;
      changed = true;
    }
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

function updateGitignore(
  repoPath: string,
  dryRun: boolean,
): { changed: boolean } {
  const gitignorePath = join(repoPath, ".gitignore");
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";
  const lines = existing.split(/\r?\n/);
  const hasDist = lines.some((line) => line.trim() === "dist/");
  if (hasDist) return { changed: false };
  const trimmed = existing.replace(/\s*$/, "");
  const output = trimmed ? `${trimmed}\ndist/\n` : "dist/\n";
  if (dryRun) {
    logInfo("dry-run", { action: "update-gitignore", path: gitignorePath });
    return { changed: true };
  }
  writeFileSync(gitignorePath, output);
  return { changed: true };
}

function replaceCiWorkflow(
  repoPath: string,
  template: string,
  dryRun: boolean,
): { changed: boolean } {
  const workflowDir = join(repoPath, ".github", "workflows");
  const workflowPath = join(workflowDir, "ci.yml");
  const existing = existsSync(workflowPath)
    ? readFileSync(workflowPath, "utf-8")
    : "";
  if (dryRun) {
    if (existing === template) return { changed: false };
    logInfo("dry-run", { action: "update-ci", path: workflowPath });
    return { changed: true };
  }
  if (!existsSync(workflowDir)) {
    mkdirSync(workflowDir, { recursive: true });
  }
  writeFileSync(workflowPath, template);
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
    execSync("npx prettier --write package.json .gitignore .github/workflows/ci.yml", {
      cwd: repoPath,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (_) { /* prettier unavailable or file missing */ }
  await runCommand("git", ["add", "-A"], repoPath, dryRun);
  await runCommand(
    "git",
    ["commit", "-m", "chore: migrate to npm publishing"],
    repoPath,
    dryRun,
  );
  await runCommand("git", ["push"], repoPath, dryRun);
}

async function publishRepo(
  repoPath: string,
  repoName: string,
  dryRun: boolean,
): Promise<void> {
  logInfo("publish-start", { repo: repoName });
  const inCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const args = inCI
    ? ["publish", "--provenance", "--access", "public"]
    : ["publish", "--access", "public"];
  await runCommand("npm", args, repoPath, dryRun);
  logInfo("publish-done", { repo: repoName });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const publishEnabled =
    Boolean(flags.publish) && !Boolean(flags["skip-publish"]) && !dryRun;
  const commitEnabled = !Boolean(flags["skip-commit"]) && !dryRun;
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

  const template = readFileSync(CI_TEMPLATE_PATH, "utf-8");
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
    const gitignoreResult = updateGitignore(repoPath, dryRun);
    const ciResult = replaceCiWorkflow(repoPath, template, dryRun);
    const updated =
      pkgResult.changed || gitignoreResult.changed || ciResult.changed;
    results.push({ name, path: repoPath, updated, skipped: false });
    logInfo("repo-done", { repo: name, updated });
  }

  if (commitEnabled) {
    for (const result of results) {
      if (result.skipped) continue;
      await commitAndPush(result.path, result.name, dryRun);
    }
  } else if (!dryRun) {
    logInfo("commit-skip", { reason: "skip-commit" });
  }

  if (publishEnabled) {
    const available = results.filter((r) => !r.skipped).map((r) => r.name);
    const phase1: string[] = available.filter((name) => name === "types");
    const phase2Targets = new Set([
      "utils",
      "runtime",
      "rehype-obsidian",
      "remark-obsidian",
    ]);
    const phase2 = available.filter((name) => phase2Targets.has(name));
    const phase3 = available.filter(
      (name) => !phase1.includes(name) && !phase2Targets.has(name),
    );

    const phases = [phase1, phase2, phase3].filter((phase) => phase.length > 0);
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i];
      await Promise.all(
        phase.map((name) => publishRepo(join(REPOS_DIR, name), name, dryRun)),
      );
      if (i < phases.length - 1) {
        logInfo("publish-wait", { seconds: 10 });
        await sleep(10000);
      }
    }
  } else if (flags.publish && !dryRun) {
    logInfo("publish-skip", { reason: "skip-publish" });
  }

  logInfo("migrate-summary", {
    total: results.length,
    updated: results.filter((r) => r.updated).length,
    skipped: results.filter((r) => r.skipped).length,
    dryRun,
    publish: publishEnabled,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
