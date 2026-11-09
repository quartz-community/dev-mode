/**
 * Detect workspace packages with local changes and run turbo tasks on them
 * plus their dependents. Replacement for `turbo --affected`, which is blind in
 * this workspace: turbo diffs the ROOT git repo, where repos/ is ignored.
 *
 *   changed [--json]                          list changed packages
 *   changed run <task...> [--no-dependents]   e.g. `changed run build typecheck`
 *
 * A package is "changed" if its repo has uncommitted changes outside
 * dist/, .turbo/, node_modules/, caches and `.gitignore`, or commits not yet
 * on its upstream branch.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./lib/args.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommandCapture, TIMEOUTS } from "./lib/exec.js";
import { safeReadJson } from "./lib/json.js";
import { REPOS_DIR, WORKSPACE_ROOT } from "./lib/sandbox.js";

const RUN_TIMEOUT_MS = 30 * 60_000;

export interface ChangedPackage {
  dir: string;
  name: string;
  uncommitted: string[];
  unpushed: number;
}

/** Paths that never affect a build/test result. */
export function isIgnorableChange(path: string): boolean {
  const p = path.replace(/^"|"$/g, "");
  return (
    p === ".gitignore" ||
    /^(dist|\.turbo|node_modules|coverage)(\/|$)/.test(p) ||
    /(^|\/)\.quartz-cache(\/|$)/.test(p) ||
    /(^|\/)\.DS_Store$/.test(p)
  );
}

/** Parse `git status --porcelain` lines into relevant changed paths. */
export function relevantChanges(porcelain: string): string[] {
  return (
    porcelain
      .split("\n")
      // Tolerate a trimmed first line (" M x" → "M x"): status is 1-2 chars + space.
      .map((line) => line.match(/^[ MADRCUT?!]{1,2} (.+)$/)?.[1])
      .filter((path): path is string => Boolean(path))
      .map((path) => path.split(" -> ").pop()!.trim())
      .filter((path) => !isIgnorableChange(path))
  );
}

async function inspectRepo(dir: string): Promise<ChangedPackage | null> {
  const path = join(REPOS_DIR, dir);
  const pkgPath = join(path, "package.json");
  if (!existsSync(join(path, ".git")) || !existsSync(pkgPath)) return null;
  const name = safeReadJson<{ name?: string }>(pkgPath).name;
  if (!name) return null;
  const opts = { timeout: TIMEOUTS.GIT_OP };
  const status = await runCommandCapture(
    "git",
    ["-C", path, "status", "--porcelain", "-uall"],
    WORKSPACE_ROOT,
    false,
    opts,
  );
  let unpushed = 0;
  try {
    const count = await runCommandCapture(
      "git",
      ["-C", path, "rev-list", "--count", "@{u}..HEAD"],
      WORKSPACE_ROOT,
      false,
      opts,
    );
    unpushed = Number(count) || 0;
  } catch {
    // no upstream configured
  }
  return { dir, name, uncommitted: relevantChanges(status), unpushed };
}

export async function findChangedPackages(): Promise<ChangedPackage[]> {
  const dirs = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const found = new Map<string, ChangedPackage>();
  await runWithConcurrency(dirs, 8, async (dir) => {
    const info = await inspectRepo(dir);
    if (info && (info.uncommitted.length || info.unpushed))
      found.set(dir, info);
  });
  return dirs
    .map((d) => found.get(d))
    .filter((p): p is ChangedPackage => Boolean(p));
}

function runTurbo(args: string[]): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("pnpm", ["turbo", "run", ...args], {
      cwd: WORKSPACE_ROOT,
      stdio: "inherit",
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), RUN_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise(code ?? 1);
    });
  });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const changed = await findChangedPackages();
  if (positional[0] !== "run") {
    if (flags.json) {
      console.log(JSON.stringify(changed, null, 2));
      return;
    }
    if (!changed.length) {
      console.log("No packages with local source changes.");
      return;
    }
    for (const p of changed) {
      const bits = [
        p.uncommitted.length
          ? `${p.uncommitted.length} uncommitted (${p.uncommitted.slice(0, 3).join(", ")}${p.uncommitted.length > 3 ? ", …" : ""})`
          : "",
        p.unpushed ? `${p.unpushed} unpushed commit(s)` : "",
      ].filter(Boolean);
      console.log(
        `${p.dir.padEnd(30)} ${p.name.padEnd(46)} ${bits.join("; ")}`,
      );
    }
    return;
  }
  const tasks = positional.slice(1);
  if (!tasks.length)
    throw new Error("Usage: changed run <task...> [--no-dependents]");
  if (!changed.length) {
    console.log("No packages with local source changes — nothing to run.");
    return;
  }
  // "...pkg" = pkg and everything that depends on it.
  const prefix = flags["no-dependents"] ? "" : "...";
  const filters = changed.map((p) => `--filter=${prefix}${p.name}`);
  console.log(
    `Changed: ${changed.map((p) => p.dir).join(", ")}${prefix ? " (+ dependents)" : ""}`,
  );
  process.exit(await runTurbo([...tasks, ...filters]));
}

if (process.argv[1]?.endsWith("changed.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
