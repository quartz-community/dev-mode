import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { parseArgs } from "./lib/args.js";
import { runCommand, TIMEOUTS } from "./lib/exec.js";
import { getDefaultBranch } from "./lib/git.js";
import { logError, logInfo, logWarn } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";
import { validatePluginName } from "./lib/validation.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const pluginName = positional[0];
  if (!pluginName) {
    throw new Error(
      "Usage: pnpm add-plugin <name> [--repo <owner/repo>] [--dry-run]",
    );
  }
  validatePluginName(pluginName);

  const manifest = readManifest();
  const repoOverride = typeof flags.repo === "string" ? flags.repo : undefined;
  const manifestEntry = manifest.plugins.find((p) => p.name === pluginName);
  const repo =
    repoOverride ?? manifestEntry?.repo ?? `${manifest.org}/${pluginName}`;

  if (!existsSync(REPOS_DIR)) {
    if (dryRun) {
      logInfo("dry-run", { action: "mkdir", path: REPOS_DIR });
    } else {
      mkdirSync(REPOS_DIR, { recursive: true });
    }
  }

  const targetDir = join(REPOS_DIR, pluginName);
  if (existsSync(targetDir)) {
    throw new Error(`Repo already exists: ${targetDir}. Remove it first with 'just remove-plugin ${pluginName}'`);
  }

  const branch = getDefaultBranch(repo);
  logInfo("clone-start", { repo, branch, path: targetDir });
  try {
    await runCommand(
      "git",
      [
        "clone",
        "--depth=1",
        "--single-branch",
        ...(branch ? ["--branch", branch] : []),
        `https://github.com/${repo}.git`,
        targetDir,
      ],
      ROOT,
      dryRun,
    );
    logInfo("clone-done", { repo, path: targetDir });
  } catch (error) {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
      logWarn("clone-cleanup", { repo, path: targetDir });
    }
    throw error;
  }

  await import("./generate-turbo-graph");

  if (dryRun) {
    logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
    logInfo("dry-run", {
      action: "pnpm-turbo-build",
      filter: `@${manifest.org}/${pluginName}`,
      cwd: ROOT,
    });
  } else {
    execSync("pnpm install", {
      stdio: "inherit",
      cwd: ROOT,
      timeout: TIMEOUTS.PNPM_INSTALL,
    });
    execSync(`pnpm turbo run build --filter=@${manifest.org}/${pluginName}`, {
      stdio: "inherit",
      cwd: ROOT,
      timeout: TIMEOUTS.TURBO_BUILD,
    });
  }

  logInfo("add-plugin-summary", { name: pluginName, repo });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
