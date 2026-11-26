/**
 * Orchestration for `just bundled-deps`: per dev.yaml repo, read its
 * default-branch lockfile (and optionally the published tarball Quartz
 * installs), work out which tracked packages are bundled at which version,
 * and compare with npm latest.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { ciTargetsFromManifest, selectCiTargets } from "../ci-status.js";
import { runWithConcurrency } from "../concurrency.js";
import { safeReadJson } from "../json.js";
import type { Manifest } from "../types.js";
import {
  applyAffected,
  bundledCopiesBelow,
  changelogBetween,
  collectBundleModules,
  detectBundleMode,
  evaluateBundle,
  isTracked,
  sourceIndex,
  trackedLockCopies,
  type BundledDep,
  type BundleLock,
  type BundleMode,
  type BundleModules,
} from "./analyze.js";
import {
  fetchDefaultBranch,
  localBundleText,
  localSourceMaps,
  tarballBundleText,
  readRepoFile,
  Registry,
  tarballSourceMaps,
  type RepoTarget,
} from "./sources.js";

export const BUILD_CONFIGS = [
  "tsup.config.ts",
  "tsup.config.mts",
  "tsup.config.js",
  "tsup.config.mjs",
  "esbuild.config.mjs",
  "esbuild.config.js",
];

export interface CollectOptions {
  reposDir: string;
  cacheDir: string;
  manifest: Manifest;
  queries: string[];
  /** Also inspect the published tarball of the version Quartz core installs. */
  published: boolean;
  /** Read every repo file from GitHub, not local clones. */
  remote: boolean;
  /** Extra (non-ecosystem) packages to track; globs allowed. */
  extraDeps: string[];
  /** Download dependency tarballs to tell stale from stale-unaffected. */
  affected: boolean;
  /** `git fetch` each local clone first (remote-tracking refs only). */
  fetch: boolean;
}

export interface RepoBundleResult {
  repo: string;
  package?: string;
  /** Where the module list for the main rows came from. */
  modulesSource?: string;
  mode?: BundleMode["kind"];
  /** Published version inspected with --published (and why that one). */
  published?: { version: string; reason: string; lockfile: string };
  rows: BundledDep[];
  skipped?: string;
  errors: string[];
  notes: string[];
}

export interface CollectResult {
  repos: RepoBundleResult[];
  unknown: string[];
}

interface PackageJsonLite {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** dev.yaml repos except Quartz core (it installs plugins, it doesn't bundle them). */
export function bundleTargets(
  manifest: Manifest,
  reposDir: string,
): RepoTarget[] {
  const core = manifest.core.name ?? "quartz";
  return ciTargetsFromManifest(manifest)
    .filter((target) => target.name !== core)
    .map((target) => ({
      name: target.name,
      slug: target.repo,
      ...(target.branch ? { branch: target.branch } : {}),
      ...(existsSync(join(reposDir, target.name, ".git"))
        ? { localPath: join(reposDir, target.name) }
        : {}),
    }));
}

interface WorkspaceInfo {
  versions: Map<string, string>;
  /** `../<dir>/` (relative to a repo root) → package name. */
  prefixes: Map<string, string>;
}

function workspaceInfo(reposDir: string): WorkspaceInfo {
  const versions = new Map<string, string>();
  const prefixes = new Map<string, string>();
  if (!existsSync(reposDir)) return { versions, prefixes };
  for (const entry of readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(reposDir, entry.name, "package.json");
    if (!existsSync(path)) continue;
    const pkg = safeReadJson<PackageJsonLite>(path);
    if (!pkg.name) continue;
    if (pkg.version) versions.set(pkg.name, pkg.version);
    prefixes.set(`../${entry.name}/`, pkg.name);
  }
  return { versions, prefixes };
}

async function readFirst(
  target: RepoTarget,
  paths: string[],
  remote: boolean,
): Promise<string | null> {
  for (const path of paths) {
    const text = await readRepoFile(target, path, undefined, { remote });
    if (text) return text;
  }
  return null;
}

function dependencyNames(
  lock: BundleLock | null,
  modules: BundleModules | null,
  tracked: (name: string) => boolean,
): string[] {
  const names = new Set<string>();
  if (lock)
    for (const copy of trackedLockCopies(lock, tracked)) names.add(copy.name);
  for (const name of modules?.keys() ?? []) if (tracked(name)) names.add(name);
  return [...names];
}

export async function collectBundledDeps(
  options: CollectOptions,
): Promise<CollectResult> {
  const registry = new Registry(options.cacheDir);
  const workspace = options.remote
    ? {
        versions: new Map<string, string>(),
        prefixes: new Map<string, string>(),
      }
    : workspaceInfo(options.reposDir);
  const all = bundleTargets(options.manifest, options.reposDir);
  const { selected, unknown } = selectCiTargets(
    all.map((target) => ({ name: target.name, repo: target.slug })),
    options.queries,
  );
  const targets = all.filter((target) =>
    selected.some((s) => s.repo === target.slug),
  );
  const tracked = (name: string) => isTracked(name, options.extraDeps);

  const latest = new Map<string, string | null>();
  const resolveLatest = async (names: string[]) => {
    await Promise.all(
      names.map(async (name) => {
        if (latest.has(name)) return;
        try {
          latest.set(name, (await registry.packument(name))?.latest ?? null);
        } catch {
          latest.set(name, null);
        }
      }),
    );
  };

  // What Quartz core installs (its lockfile, else its ranges) for --published.
  let coreLock: BundleLock | null = null;
  let corePackage: PackageJsonLite | null = null;
  if (options.published) {
    const core: RepoTarget = {
      name: options.manifest.core.name ?? "quartz",
      slug: options.manifest.core.repo,
      ...(options.manifest.core.branch
        ? { branch: options.manifest.core.branch }
        : {}),
      ...(existsSync(join(options.reposDir, "quartz", ".git"))
        ? { localPath: join(options.reposDir, "quartz") }
        : {}),
    };
    coreLock = parseJson(
      await readRepoFile(core, "package-lock.json", undefined, {
        remote: options.remote,
      }),
    );
    corePackage = parseJson(
      await readRepoFile(core, "package.json", undefined, {
        remote: options.remote,
      }),
    );
  }

  const results: RepoBundleResult[] = [];
  const bundleTexts = new Map<string, { main?: string; npm?: string }>();
  const packageToTarget = new Map<string, RepoTarget>();

  const outcome = await runWithConcurrency(targets, 8, async (target) => {
    const result: RepoBundleResult = {
      repo: target.name,
      rows: [],
      errors: [],
      notes: [],
    };
    const bundles: { main?: string; npm?: string } = {};
    bundleTexts.set(target.name, bundles);
    results.push(result);
    if (options.fetch && !options.remote) {
      const error = await fetchDefaultBranch(target);
      if (error)
        result.errors.push(`git fetch: ${error} (using the local ref)`);
    }
    const pkg = parseJson<PackageJsonLite>(
      await readRepoFile(target, "package.json", undefined, {
        remote: options.remote,
      }),
    );
    if (!pkg?.name) {
      result.skipped = "no package.json on the default branch";
      return;
    }
    result.package = pkg.name;
    packageToTarget.set(pkg.name, target);
    const lock = parseJson<BundleLock>(
      await readRepoFile(target, "package-lock.json", undefined, {
        remote: options.remote,
      }),
    );
    const mode = detectBundleMode(
      await readFirst(target, BUILD_CONFIGS, options.remote),
    );
    result.mode = mode.kind;
    let info = null;
    try {
      info = await registry.packument(pkg.name);
    } catch (error) {
      result.errors.push(
        `npm: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Module list for the default-branch rows: the local build, else the
    // latest published build (names only: its lockfile paths may differ).
    let modules: BundleModules | null = null;
    if (target.localPath && !options.remote) {
      const maps = localSourceMaps(target.localPath);
      if (maps.length) {
        modules = collectBundleModules(maps, workspace.prefixes);
        result.modulesSource = "local dist source maps";
        bundles.main = localBundleText(target.localPath);
      }
    }
    if (!modules && info?.latest) {
      try {
        const files = await registry.tarball(pkg.name, info.latest);
        const maps = files ? tarballSourceMaps(files) : [];
        if (maps.length) {
          modules = collectBundleModules(maps);
          result.modulesSource = `source maps of published ${info.latest}`;
          bundles.main = tarballBundleText(files!);
        }
      } catch (error) {
        result.errors.push(
          `tarball ${pkg.name}@${info.latest}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    result.modulesSource ??= "none (build config + lockfile heuristic)";

    if (!lock) {
      result.skipped = "no package-lock.json on the default branch";
    } else {
      await resolveLatest(dependencyNames(lock, modules, tracked));
      result.rows.push(
        ...evaluateBundle({
          repo: target.name,
          package: pkg.name,
          source: "main",
          lock,
          modules,
          modulesByNameOnly: true,
          mode,
          tracked,
          latest: (name) => latest.get(name) ?? null,
          workspace: (name) => workspace.versions.get(name) ?? null,
        }),
      );
    }

    if (!options.published) return;
    if (!info) {
      result.notes.push("not published to npm (--published skipped)");
      return;
    }
    const versions = Object.keys(info.versions);
    const locked = coreLock?.packages?.[`node_modules/${pkg.name}`]?.version;
    const range =
      corePackage?.dependencies?.[pkg.name] ??
      corePackage?.devDependencies?.[pkg.name];
    let version: string | null = null;
    let reason = "";
    if (locked && info.versions[locked]) {
      version = locked;
      reason = "Quartz core's package-lock.json";
    } else if (range && semver.maxSatisfying(versions, range)) {
      version = semver.maxSatisfying(versions, range);
      reason = `Quartz core's range ${range}`;
    } else if (info.latest) {
      version = info.latest;
      reason = "npm latest (not a Quartz core dependency)";
    }
    if (!version) return;
    try {
      const files = await registry.tarball(pkg.name, version);
      const maps = files ? tarballSourceMaps(files) : [];
      if (!maps.length) {
        result.errors.push(
          `${pkg.name}@${version}: tarball has no source maps`,
        );
        return;
      }
      const publishedModules = collectBundleModules(maps);
      bundles.npm = tarballBundleText(files!);
      // The lockfile the release was built with: the published gitHead, else the version tag.
      const gitHead = info.versions[version]?.gitHead;
      let publishedLock: BundleLock | null = null;
      let lockfile = "unavailable";
      for (const ref of [gitHead, `v${version}`, `${pkg.name}@${version}`]) {
        if (!ref) continue;
        publishedLock = parseJson(
          await readRepoFile(target, "package-lock.json", ref, {
            remote: options.remote,
          }),
        );
        if (publishedLock) {
          lockfile =
            ref === gitHead ? `gitHead ${ref.slice(0, 7)}` : `tag ${ref}`;
          break;
        }
      }
      result.published = { version, reason, lockfile };
      await resolveLatest(
        dependencyNames(publishedLock, publishedModules, tracked),
      );
      result.rows.push(
        ...evaluateBundle({
          repo: target.name,
          package: pkg.name,
          source: "npm",
          sourceVersion: version,
          lock: publishedLock,
          modules: publishedModules,
          mode,
          tracked,
          latest: (name) => latest.get(name) ?? null,
          workspace: (name) => workspace.versions.get(name) ?? null,
        }),
      );
    } catch (error) {
      result.errors.push(
        `--published ${pkg.name}@${version}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  for (const { item, error } of outcome.failures) {
    const existing = results.find((result) => result.repo === item.name);
    if (existing) existing.errors.push(error.message);
    else
      results.push({
        repo: item.name,
        rows: [],
        errors: [error.message],
        notes: [],
      });
  }

  // stale → stale-unaffected when the bundled files didn't change.
  const indices = new Map<string, Promise<Map<string, string> | null>>();
  const indexOf = (name: string, version: string) => {
    const key = `${name}@${version}`;
    let pending = indices.get(key);
    if (!pending) {
      pending = registry
        .tarball(name, version)
        .then((files) => (files ? sourceIndex(files) : null))
        .catch(() => null);
      indices.set(key, pending);
    }
    return pending;
  };
  const changelogs = new Map<string, Promise<string | null>>();
  const changelogOf = (name: string) => {
    let pending = changelogs.get(name);
    if (!pending) {
      pending = (async () => {
        const target =
          packageToTarget.get(name) ??
          all.find(
            (t) =>
              workspace.prefixes.get(`../${t.name}/`) === name ||
              t.slug.split("/")[1] === name.split("/")[1],
          );
        if (target) {
          const text = await readRepoFile(target, "CHANGELOG.md", undefined, {
            remote: options.remote,
          }).catch(() => null);
          if (text) return text;
        }
        const version = latest.get(name);
        if (!version) return null;
        const files = await registry.tarball(name, version).catch(() => null);
        return files?.get("CHANGELOG.md")?.toString("utf-8") ?? null;
      })();
      changelogs.set(name, pending);
    }
    return pending;
  };
  for (const result of results) {
    result.rows = await Promise.all(
      result.rows.map(async (row) => {
        if (row.status !== "stale" || !row.version || !row.latest) return row;
        let next = row;
        if (options.affected && row.files?.length) {
          next = applyAffected(
            row,
            await indexOf(row.dependency, row.version),
            await indexOf(row.dependency, row.latest),
            bundleTexts.get(result.repo)?.[row.source] || undefined,
          );
        }
        const changelog = await changelogOf(row.dependency);
        return changelog
          ? {
              ...next,
              changelog: changelogBetween(changelog, row.version, row.latest),
            }
          : next;
      }),
    );
  }

  results.sort((a, b) => a.repo.localeCompare(b.repo));
  return { repos: results, unknown };
}

export interface StaleBundleWarning {
  /** Package being released and its new version. */
  name: string;
  version: string;
  /** Repos whose default-branch lockfile bundles an older copy. */
  repos: Array<{ repo: string; versions: string[] }>;
}

/**
 * For `release plan`: which repos' default-branch lockfiles (local
 * `origin/HEAD`, offline) bundle a copy of a package older than the version
 * about to be released. They need a lockfile bump + release to ship it.
 */
export async function staleBundlesForReleases(
  repos: Array<{ repo: string; path: string; category?: string }>,
  releases: Array<{ name: string; to: string }>,
): Promise<StaleBundleWarning[]> {
  const bundlers = repos.filter((repo) => repo.category !== "core");
  const inputs = new Map<string, { lock: BundleLock; mode: BundleMode }>();
  await runWithConcurrency(bundlers, 8, async (repo) => {
    const target: RepoTarget = {
      name: repo.repo,
      slug: "",
      localPath: repo.path,
    };
    const local = { localOnly: true };
    const lock = parseJson<BundleLock>(
      await readRepoFile(target, "package-lock.json", undefined, local),
    );
    if (!lock) return;
    let config: string | null = null;
    for (const path of BUILD_CONFIGS) {
      config = await readRepoFile(target, path, undefined, local);
      if (config) break;
    }
    inputs.set(repo.repo, { lock, mode: detectBundleMode(config) });
  });
  return releases
    .map((release) => ({
      name: release.name,
      version: release.to,
      repos: [...inputs]
        .map(([repo, { lock, mode }]) => ({
          repo,
          versions: [
            ...new Set(
              bundledCopiesBelow(lock, mode, release.name, release.to).map(
                (copy) => copy.version,
              ),
            ),
          ].sort(semver.compare),
        }))
        .filter((entry) => entry.versions.length > 0)
        .sort((a, b) => a.repo.localeCompare(b.repo)),
    }))
    .filter((warning) => warning.repos.length > 0);
}
