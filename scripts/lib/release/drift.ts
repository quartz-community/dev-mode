/**
 * Version drift between a repo's own package-lock.json (what its standalone
 * CI installs with `npm ci`) and what the dev-mode workspace resolves for the
 * same direct dependency through pnpm (pnpm-lock.yaml importers).
 *
 * Motivation: themes-core passed in the workspace (pnpm resolved
 * @lucide/icons 1.70) but failed in its own CI, whose lockfile pinned 1.26.
 * Fully offline: only reads lockfiles.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { parse } from "yaml";
import { safeReadJson } from "../json.js";
import type { PackageJson } from "./workspace.js";

/** Linked from local clones on purpose (see .pnpmfile.cjs) — never drift. */
export const WORKSPACE_LINKED =
  /^(?:@quartz-community\/|@quartz-themes\/|@jackyzha0\/)/;

export type DependencyField =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies";

const FIELDS: DependencyField[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export interface DriftEntry {
  repo: string;
  dependency: string;
  field: DependencyField;
  specifier: string;
  /** Version the repo's package-lock.json installs. */
  lockfile: string;
  /** Version pnpm resolves for the same importer in the workspace. */
  workspace: string;
  /** "major" | "minor": the first differing component. */
  level: "major" | "minor";
  /** Which side is newer. */
  newer: "workspace" | "lockfile";
}

export interface RepoDriftResult {
  repo: string;
  /** Why the repo was not compared (no lockfile, not a pnpm importer, …). */
  skipped?: string;
  compared: number;
  drift: DriftEntry[];
}

/** Minimal shape of the parts of pnpm-lock.yaml we read. */
export interface PnpmImporterDependency {
  specifier?: string;
  version?: string;
}
export type PnpmImporter = Partial<
  Record<DependencyField, Record<string, PnpmImporterDependency>>
>;
export interface PnpmLock {
  importers?: Record<string, PnpmImporter>;
}

export interface NpmLock {
  packages?: Record<string, { version?: string; link?: boolean }>;
  /** lockfileVersion 1 */
  dependencies?: Record<string, { version?: string }>;
}

/**
 * pnpm writes resolved versions with peer suffixes, e.g.
 * `8.5.1(jiti@2.7.0)(typescript@5.9.3)`; links as `link:../types`.
 * Returns a clean semver, or undefined for links / non-registry sources.
 */
export function normalizePnpmVersion(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  if (/^(?:link|file|workspace|git|github|https?):/.test(raw)) return undefined;
  const base = raw.split("(")[0].trim();
  // npm aliases resolve as `name@version` in pnpm-lock.
  const at = base.lastIndexOf("@");
  return semver.valid(at > 0 ? base.slice(at + 1) : base) ?? undefined;
}

export function npmLockVersion(
  lock: NpmLock,
  name: string,
): string | undefined {
  const entry = lock.packages?.[`node_modules/${name}`];
  const version = entry?.link
    ? undefined
    : (entry?.version ?? lock.dependencies?.[name]?.version);
  return version && semver.valid(version) ? version : undefined;
}

export function driftLevel(
  a: string,
  b: string,
): "major" | "minor" | undefined {
  if (semver.major(a) !== semver.major(b)) return "major";
  if (semver.minor(a) !== semver.minor(b)) return "minor";
  return undefined;
}

/** Compare one repo's direct dependencies. Pure; used by tests. */
export function compareRepoDrift(
  repo: string,
  packageJson: PackageJson,
  npmLock: NpmLock,
  importer: PnpmImporter,
): RepoDriftResult {
  const drift: DriftEntry[] = [];
  const seen = new Set<string>();
  let compared = 0;
  for (const field of FIELDS) {
    for (const [dependency, specifier] of Object.entries(
      packageJson[field] ?? {},
    )) {
      if (WORKSPACE_LINKED.test(dependency) || seen.has(dependency)) continue;
      const lockfile = npmLockVersion(npmLock, dependency);
      // pnpm lists a peer that is also a devDependency under devDependencies.
      const workspaceRaw = FIELDS.map(
        (f) => importer[f]?.[dependency]?.version,
      ).find(Boolean);
      const workspace = normalizePnpmVersion(workspaceRaw);
      if (!lockfile || !workspace) continue;
      seen.add(dependency);
      compared += 1;
      const level = driftLevel(lockfile, workspace);
      if (!level) continue;
      drift.push({
        repo,
        dependency,
        field,
        specifier: String(specifier),
        lockfile,
        workspace,
        level,
        newer: semver.gt(workspace, lockfile) ? "workspace" : "lockfile",
      });
    }
  }
  drift.sort((a, b) => a.dependency.localeCompare(b.dependency));
  return { repo, compared, drift };
}

export function readPnpmLock(path: string): PnpmLock {
  if (!existsSync(path)) {
    throw new Error(
      `${path} not found — run 'just setup' (pnpm install) first`,
    );
  }
  return parse(readFileSync(path, "utf-8")) as PnpmLock;
}

/**
 * Drift for a set of repos. `importerKey` is how the repo appears in
 * pnpm-lock.yaml importers (`repos/<dir>`).
 */
export function collectDrift(
  repos: Array<{ repo: string; path: string }>,
  pnpmLock: PnpmLock,
): RepoDriftResult[] {
  const results: RepoDriftResult[] = [];
  for (const { repo, path } of repos) {
    const lockPath = join(path, "package-lock.json");
    const packagePath = join(path, "package.json");
    if (!existsSync(lockPath)) {
      results.push({
        repo,
        skipped: "no package-lock.json",
        compared: 0,
        drift: [],
      });
      continue;
    }
    if (!existsSync(packagePath)) {
      results.push({
        repo,
        skipped: "no package.json",
        compared: 0,
        drift: [],
      });
      continue;
    }
    const importer = pnpmLock.importers?.[`repos/${repo}`];
    if (!importer) {
      results.push({
        repo,
        skipped:
          "not a pnpm workspace member (standalone: its own lockfile is what runs)",
        compared: 0,
        drift: [],
      });
      continue;
    }
    results.push(
      compareRepoDrift(
        repo,
        safeReadJson<PackageJson>(packagePath),
        safeReadJson<NpmLock>(lockPath),
        importer,
      ),
    );
  }
  return results;
}

export function formatDriftEntry(entry: DriftEntry): string {
  return `${entry.repo}: ${entry.dependency} lockfile ${entry.lockfile} vs workspace ${entry.workspace} (${entry.level}, ${entry.field} ${entry.specifier})`;
}

export interface DriftGroup {
  dependency: string;
  /** Worst level across repos. */
  level: "major" | "minor";
  lockfileVersions: string[];
  workspaceVersions: string[];
  repos: string[];
}

/**
 * One row per dependency. Widespread drift (e.g. @types/node in every repo)
 * usually means "lockfiles haven't been refreshed in a while"; drift in one
 * or two repos is the kind that bit themes-core, so isolated groups sort first.
 */
export function groupDrift(entries: DriftEntry[]): DriftGroup[] {
  const groups = new Map<string, DriftGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.dependency) ?? {
      dependency: entry.dependency,
      level: entry.level,
      lockfileVersions: [],
      workspaceVersions: [],
      repos: [],
    };
    if (entry.level === "major") group.level = "major";
    if (!group.lockfileVersions.includes(entry.lockfile))
      group.lockfileVersions.push(entry.lockfile);
    if (!group.workspaceVersions.includes(entry.workspace))
      group.workspaceVersions.push(entry.workspace);
    if (!group.repos.includes(entry.repo)) group.repos.push(entry.repo);
    groups.set(entry.dependency, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      lockfileVersions: group.lockfileVersions.sort(semver.compare),
      workspaceVersions: group.workspaceVersions.sort(semver.compare),
      repos: group.repos.sort(),
    }))
    .sort(
      (a, b) =>
        Number(b.level === "major") - Number(a.level === "major") ||
        a.repos.length - b.repos.length ||
        a.dependency.localeCompare(b.dependency),
    );
}

/** Glob-ish ignore patterns (`@types/*`, `sass*`) for --ignore. */
export function matchesIgnore(dependency: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const regex = new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
        .join(".*")}$`,
    );
    return regex.test(dependency);
  });
}

export function formatDriftGroup(group: DriftGroup, maxRepos = 6): string {
  const repos =
    group.repos.length > maxRepos
      ? `${group.repos.slice(0, maxRepos).join(", ")}, +${group.repos.length - maxRepos} more`
      : group.repos.join(", ");
  return `${group.dependency}: lockfile ${group.lockfileVersions.join("/")} vs workspace ${group.workspaceVersions.join("/")} (${group.level}) in ${group.repos.length} repo(s): ${repos}`;
}
