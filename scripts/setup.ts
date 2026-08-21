import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { parseArgs } from "./lib/args.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommand, TIMEOUTS } from "./lib/exec.js";
import { getDefaultBranch } from "./lib/git.js";
import { logError, logInfo, logWarn } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";
import type { ManifestRepo } from "./lib/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
function normalizeRepo(name: string, repo: string, branch?: string) {
  return { name, repo, branch };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const preset = typeof flags.preset === "string" ? flags.preset : undefined;
  const pluginList = typeof flags.plugins === "string" ? flags.plugins : "";
  const concurrency = Number(flags.concurrency ?? 8);
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("--concurrency must be a positive number");
  }

  const manifest = readManifest();
  const manifestPlugins = manifest.plugins.map((p) => p.name);
  const selectedPlugins = new Set<string>();

  if (preset) {
    const presetConfig = manifest.presets?.[preset];
    if (!presetConfig) {
      const available = Object.keys(manifest.presets ?? {}).join(", ");
      throw new Error(`Unknown preset: ${preset}. Available: ${available}`);
    }
    if (presetConfig.plugins.includes("*")) {
      manifestPlugins.forEach((name) => selectedPlugins.add(name));
    } else {
      presetConfig.plugins.forEach((name) => selectedPlugins.add(name));
    }
  }

  if (pluginList) {
    pluginList
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => selectedPlugins.add(name));
  }

  const repos: ManifestRepo[] = [];
  repos.push(normalizeRepo("quartz", manifest.core.repo, manifest.core.branch));
  manifest.infrastructure.forEach((infra) => {
    repos.push(normalizeRepo(infra.name ?? infra.repo, infra.repo));
  });

  if (manifest.themes?.packages) {
    manifest.themes.packages.forEach((theme) => {
      repos.push(
        normalizeRepo(theme.name ?? theme.repo, theme.repo, theme.branch),
      );
    });
  }

  if (manifest.tools?.length) {
    manifest.tools.forEach((tool) => {
      repos.push(normalizeRepo(tool.name ?? tool.repo, tool.repo, tool.branch));
    });
  }

  for (const plugin of selectedPlugins) {
    const manifestEntry = manifest.plugins.find((p) => p.name === plugin);
    const repo = manifestEntry?.repo ?? `${manifest.org}/${plugin}`;
    repos.push(normalizeRepo(plugin, repo));
  }

  if (!existsSync(REPOS_DIR)) {
    if (dryRun) {
      logInfo("dry-run", { action: "mkdir", path: REPOS_DIR });
    } else {
      mkdirSync(REPOS_DIR, { recursive: true });
    }
  }

  const clones: { name: string; status: "cloned" | "skipped" }[] = [];

  const { failures } = await runWithConcurrency(repos, concurrency, async (repo) => {
    const targetDir = join(REPOS_DIR, repo.name ?? repo.repo);
    if (existsSync(targetDir)) {
      logWarn("clone-skip", { repo: repo.repo, path: targetDir });
      clones.push({ name: repo.name ?? repo.repo, status: "skipped" });
      return;
    }

    const branch = repo.branch ?? getDefaultBranch(repo.repo);
    const args = [
      "clone",
      "--depth=1",
      "--single-branch",
      ...(branch ? ["--branch", branch] : []),
      `https://github.com/${repo.repo}.git`,
      targetDir,
    ];

    logInfo("clone-start", { repo: repo.repo, branch, path: targetDir });
    try {
      await runCommand("git", args, ROOT, dryRun);
      logInfo("clone-done", { repo: repo.repo, path: targetDir });
      clones.push({ name: repo.name ?? repo.repo, status: "cloned" });
    } catch (error) {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
        logWarn("clone-cleanup", { repo: repo.repo, path: targetDir });
      }
      throw error;
    }
  });
  if (failures.length > 0) {
    for (const { item, error } of failures) {
      logError(`Clone failed: ${(item as { repo: string }).repo}`, {
        error: error.message,
      });
    }
    throw new Error(`${failures.length} of ${repos.length} clone operations failed`);
  }

  await import("./generate-turbo-graph");

  if (dryRun) {
    logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
    logInfo("dry-run", { action: "pnpm-turbo-build", cwd: ROOT });
  } else {
    execSync("pnpm install --no-frozen-lockfile", {
      stdio: "inherit",
      cwd: ROOT,
      timeout: TIMEOUTS.PNPM_INSTALL,
    });
    execSync("pnpm turbo run build", {
      stdio: "inherit",
      cwd: ROOT,
      timeout: TIMEOUTS.TURBO_BUILD,
    });
  }

  logInfo("setup-summary", {
    total: clones.length,
    cloned: clones.filter((c) => c.status === "cloned").length,
    skipped: clones.filter((c) => c.status === "skipped").length,
    plugins: [...selectedPlugins],
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
