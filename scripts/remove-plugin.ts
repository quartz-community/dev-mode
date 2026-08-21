import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { parseArgs } from "./lib/args.js";
import { runCommandCapture, TIMEOUTS } from "./lib/exec.js";
import { logError, logInfo } from "./lib/log.js";
import { validatePluginName } from "./lib/validation.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");


async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const force = Boolean(flags.force);
  const pluginName = positional[0];
  if (!pluginName) {
    throw new Error("Usage: pnpm remove-plugin <name> [--force] [--dry-run]");
  }
  validatePluginName(pluginName);

  const targetDir = join(REPOS_DIR, pluginName);
  if (!existsSync(targetDir)) {
    throw new Error(`Repo not found: ${targetDir}`);
  }

  const status = await runCommandCapture(
    "git",
    ["status", "--porcelain"],
    targetDir,
    dryRun,
  );
  if (status && !force) {
    throw new Error(`Repo has uncommitted changes: ${pluginName}. Commit with 'just commit ${pluginName} "message"' or use --force`);
  }

  if (dryRun) {
    logInfo("dry-run", { action: "remove", path: targetDir });
  } else {
    rmSync(targetDir, { recursive: true, force: true });
  }

  await import("./generate-turbo-graph");

  if (dryRun) {
    logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
  } else {
    execSync("pnpm install", {
      stdio: "inherit",
      cwd: ROOT,
      timeout: TIMEOUTS.PNPM_INSTALL,
    });
  }

  logInfo("remove-plugin-summary", { name: pluginName });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
