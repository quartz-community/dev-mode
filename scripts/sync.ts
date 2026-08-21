import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { parseArgs } from "./lib/args.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommandCapture, TIMEOUTS } from "./lib/exec.js";
import { logError, logInfo, logWarn } from "./lib/log.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");


async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const force = Boolean(flags.force);
  const repoFilter = typeof flags.repos === "string" ? flags.repos : "";

  if (!existsSync(REPOS_DIR)) {
    throw new Error("repos/ directory not found. Run 'just setup' to clone workspace packages");
  }

  const repoDirs = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const selected = repoFilter
    ? repoFilter
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : repoDirs;

  const missing = selected.filter((name) => !repoDirs.includes(name));
  if (missing.length > 0) {
    throw new Error(`Repos not found: ${missing.join(", ")}`);
  }

  const results: { name: string; status: string; changed: boolean }[] = [];
  const { failures } = await runWithConcurrency(selected, 8, async (name) => {
    const repoPath = join(REPOS_DIR, name);
    logInfo("sync-start", { repo: name });
    await runCommandCapture("git", ["fetch", "origin"], repoPath, dryRun);

    const dirty = await runCommandCapture(
      "git",
      ["status", "--porcelain"],
      repoPath,
      dryRun,
    );

    if (dirty && !force) {
      logWarn("sync-skip-dirty", { repo: name });
      results.push({ name, status: "dirty", changed: false });
      return;
    }

    const before = await runCommandCapture(
      "git",
      ["rev-parse", "HEAD"],
      repoPath,
      dryRun,
    );
    await runCommandCapture("git", ["pull", "--ff-only"], repoPath, dryRun);
    const after = await runCommandCapture(
      "git",
      ["rev-parse", "HEAD"],
      repoPath,
      dryRun,
    );

    const changed = before !== "" && after !== "" ? before !== after : false;
    results.push({ name, status: "synced", changed });
    logInfo("sync-done", { repo: name, changed });
  });
  if (failures.length > 0) {
    for (const { item, error } of failures) {
      logError(`Sync failed: ${String(item)}`, { error: error.message });
    }
    throw new Error(`${failures.length} of ${selected.length} sync operations failed`);
  }

  const changedAny = results.some((r) => r.changed);
  if (changedAny) {
    if (dryRun) {
      logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
    } else {
      execSync("pnpm install", {
        stdio: "inherit",
        cwd: ROOT,
        timeout: TIMEOUTS.PNPM_INSTALL,
      });
    }
  } else {
    logInfo("sync-no-changes");
  }

  logInfo("sync-summary", { results });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
