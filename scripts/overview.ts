/**
 * One-screen orientation for a fresh agent session (`just overview`).
 *
 * Reports, quickly and offline: toolchain + browser, repos with uncommitted
 * changes (ignoring dist/), repos not on their default branch, packages whose
 * dist/ is missing or older than src/ (Quartz would run OLD code), which
 * fixtures/repros exist, and freshness of generated artifacts in .dev/.
 *
 *   overview [--json] [--brief]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./lib/args.js";
import { resolveChromium } from "./lib/browser.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommandCapture, TIMEOUTS } from "./lib/exec.js";
import {
  DEV_DIR,
  distState,
  REPOS_DIR,
  WORKSPACE_ROOT,
} from "./lib/sandbox.js";
import { listFixtures, listRepros } from "./lib/site-target.js";

interface RepoInfo {
  dir: string;
  branch: string;
  changes: string[];
  dist: "missing" | "stale" | null;
}

function version(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, {
      timeout: 5_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "not found";
  }
}

function ageOf(path: string): string | null {
  if (!existsSync(path)) return null;
  const mins = Math.round((Date.now() - statSync(path).mtimeMs) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

async function repoInfo(dir: string): Promise<RepoInfo> {
  const path = join(REPOS_DIR, dir);
  let branch = "?";
  let changes: string[] = [];
  if (existsSync(join(path, ".git"))) {
    try {
      branch = await runCommandCapture(
        "git",
        ["-C", path, "rev-parse", "--abbrev-ref", "HEAD"],
        WORKSPACE_ROOT,
        false,
        { timeout: TIMEOUTS.GIT_OP },
      );
      const status = await runCommandCapture(
        "git",
        ["-C", path, "status", "--porcelain", "--", ".", ":!dist/"],
        WORKSPACE_ROOT,
        false,
        { timeout: TIMEOUTS.GIT_OP },
      );
      changes = status.split("\n").filter(Boolean);
    } catch {
      // leave defaults
    }
  }
  return { dir, branch, changes, dist: distState(path) };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (!existsSync(REPOS_DIR)) {
    console.log("repos/ not found — run `just setup` first.");
    process.exit(1);
  }
  const dirs = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const infos = new Map<string, RepoInfo>();
  await runWithConcurrency(dirs, 8, async (dir) => {
    infos.set(dir, await repoInfo(dir));
  });
  const repos = dirs
    .map((d) => infos.get(d))
    .filter((r): r is RepoInfo => Boolean(r));
  const browser = resolveChromium();

  const dirty = repos.filter((r) => r.changes.length > 0);
  // Pre-existing one-line `.gitignore` edits are common workspace noise; separate them.
  const onlyGitignore = dirty.filter((r) =>
    r.changes.every((c) => c.endsWith(" .gitignore")),
  );
  const realDirty = dirty.filter((r) => !onlyGitignore.includes(r));
  const offBranch = repos.filter(
    (r) => r.branch !== "main" && r.branch !== "master" && r.branch !== "?",
  );
  const stale = repos.filter((r) => r.dist);

  const artifacts = {
    catalog: ageOf(join(DEV_DIR, "catalog/catalog.json")),
    e2eFixtures: ageOf(join(WORKSPACE_ROOT, "e2e/.output")),
    visualBaseline: ageOf(join(DEV_DIR, "visual/base/manifest.json")),
  };

  const report = {
    toolchain: {
      node: process.version,
      pnpm: version("pnpm", ["--version"]),
      just: version("just", ["--version"]),
    },
    browser: {
      path: browser.executablePath ?? "playwright bundled",
      source: browser.source,
    },
    repos: repos.length,
    dirty: realDirty.map((r) => ({ repo: r.dir, changes: r.changes })),
    gitignoreOnlyDirty: onlyGitignore.map((r) => r.dir),
    offDefaultBranch: offBranch.map((r) => ({ repo: r.dir, branch: r.branch })),
    staleDist: stale.map((r) => ({ repo: r.dir, state: r.dist })),
    fixtures: listFixtures(),
    repros: listRepros(),
    artifacts,
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const t = report.toolchain;
  console.log(
    `Quartz dev-mode — ${repos.length} repos · node ${t.node} · pnpm ${t.pnpm} · ${t.just}`,
  );
  console.log(`Browser: ${report.browser.path} (${report.browser.source})`);
  if (realDirty.length) {
    console.log(
      `\nUncommitted changes (${realDirty.length} repos, excluding dist/):`,
    );
    for (const r of realDirty) {
      const shown = r.changes
        .slice(0, flags.brief ? 3 : 8)
        .map((c) => c.trim())
        .join(", ");
      console.log(
        `  ${r.dir.padEnd(32)} ${shown}${r.changes.length > (flags.brief ? 3 : 8) ? ", …" : ""}`,
      );
    }
  } else {
    console.log("\nNo uncommitted source changes.");
  }
  if (onlyGitignore.length) {
    console.log(
      `  (+${onlyGitignore.length} repos with only a modified .gitignore — likely pre-existing noise)`,
    );
  }
  if (offBranch.length) {
    console.log(
      `\nNot on main: ${offBranch.map((r) => `${r.dir}@${r.branch}`).join(", ")}`,
    );
  }
  if (stale.length) {
    console.log(
      `\n⚠ dist/ older than src/ (Quartz would run OLD code): ${stale.map((r) => `${r.dir}${r.dist === "missing" ? " (missing)" : ""}`).join(", ")}`,
    );
    console.log("  Fix: just build-affected   (or just build-plugin <name>)");
  }
  console.log(
    `\nSite targets: ${report.fixtures.map((f) => `fixture:${f}`).join(", ")}${report.repros.length ? `, ${report.repros.map((r) => `repro:${r}`).join(", ")}` : ""}`,
  );
  console.log(
    `Generated: catalog ${artifacts.catalog ?? "— (just catalog)"} · e2e fixtures ${artifacts.e2eFixtures ?? "— (just e2e-build)"} · visual baseline ${artifacts.visualBaseline ?? "—"}`,
  );
  if (!flags.brief) {
    console.log(
      "\nStart here: docs/ARCHITECTURE.md · skills in .claude/skills/ · `just` lists all commands",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
