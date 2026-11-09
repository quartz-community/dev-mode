import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeReadJson } from "../json.js";
import { RUNTIME_DEPENDENCY_KINDS, type WorkspacePackage } from "./graph.js";

export const DEFAULT_VERIFY_TASKS = [
  "build",
  "typecheck",
  "lint",
  "test",
] as const;

/**
 * Tasks that are known to fail inside the pnpm workspace and are excluded in
 * the workspace CI (see AGENTS.md "Pitfalls").
 */
export const KNOWN_WORKSPACE_FAILURES: ReadonlySet<string> = new Set([
  "@quartz-themes/core#test",
]);

/**
 * All workspace packages that (transitively) depend on any of `names` at
 * runtime. Private consumers (Quartz core) are included but not expanded:
 * plugins that peer-depend on Quartz are not affected by its lockfile.
 */
export function transitiveDependents(
  packages: WorkspacePackage[],
  names: Iterable<string>,
): Set<string> {
  const result = new Set<string>();
  const seeds = [...names];
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const pkg of packages) {
      if (result.has(pkg.name) || pkg.name === current) continue;
      const depends = RUNTIME_DEPENDENCY_KINDS.some(
        (kind) => pkg[kind]?.[current] !== undefined,
      );
      if (depends) {
        result.add(pkg.name);
        if (pkg.kind !== "private") queue.push(pkg.name);
      }
    }
  }
  for (const name of seeds) result.delete(name);
  return result;
}

/**
 * The script that checks formatting without writing. Repos differ: plugins use
 * `format` = `prettier . --check`, syncer has `check-formatting`, and some
 * `format` scripts *write* — those are never used.
 */
export function formatCheckScript(
  scripts: Record<string, string> | undefined,
): string | null {
  if (!scripts) return null;
  if (scripts["format:check"]) return "format:check";
  if (scripts["check-formatting"]) return "check-formatting";
  const format = scripts.format;
  if (
    format &&
    /--check\b|--list-different\b|\s-l\b/.test(format) &&
    !/--write\b|\s-w\b/.test(format)
  ) {
    return "format";
  }
  return null;
}

export type TaskOutcome = "pass" | "fail" | "skipped" | "ignored";

export interface TaskResult {
  package: string;
  task: string;
  outcome: TaskOutcome;
  exitCode: number | null;
  cache?: string;
}

interface TurboSummaryTask {
  taskId?: string;
  package?: string;
  task?: string;
  command?: string;
  execution?: { exitCode?: number | null } | null;
  cache?: { status?: string };
}

export interface TurboSummary {
  tasks?: TurboSummaryTask[];
  execution?: { exitCode?: number };
}

export function parseTurboSummary(summary: TurboSummary): TaskResult[] {
  const results: TaskResult[] = [];
  for (const task of summary.tasks ?? []) {
    if (!task.package || !task.task) continue;
    if (task.command === "<NONEXISTENT>") continue;
    const exitCode = task.execution?.exitCode ?? null;
    const id = `${task.package}#${task.task}`;
    let outcome: TaskOutcome =
      exitCode === null ? "skipped" : exitCode === 0 ? "pass" : "fail";
    if (outcome === "fail" && KNOWN_WORKSPACE_FAILURES.has(id))
      outcome = "ignored";
    results.push({
      package: task.package,
      task: task.task,
      outcome,
      exitCode,
      cache: task.cache?.status,
    });
  }
  return results;
}

/** Newest turbo run summary written at or after `since` (ms epoch). */
export function findTurboSummary(root: string, since: number): string | null {
  const dir = join(root, ".turbo", "runs");
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      path: join(dir, file),
      mtime: statSync(join(dir, file)).mtimeMs,
    }))
    .filter((entry) => entry.mtime >= since - 1000)
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

export function readTurboSummary(path: string): TaskResult[] {
  return parseTurboSummary(safeReadJson<TurboSummary>(path));
}

export interface PackageVerdict {
  name: string;
  ok: boolean;
  tasks: Record<string, TaskOutcome>;
}

export function verdictsByPackage(results: TaskResult[]): PackageVerdict[] {
  const byPackage = new Map<string, PackageVerdict>();
  for (const result of results) {
    const verdict = byPackage.get(result.package) ?? {
      name: result.package,
      ok: true,
      tasks: {},
    };
    verdict.tasks[result.task] = result.outcome;
    if (result.outcome === "fail" || result.outcome === "skipped")
      verdict.ok = false;
    byPackage.set(result.package, verdict);
  }
  return [...byPackage.values()].sort((a, b) => a.name.localeCompare(b.name));
}
