import semver from "semver";
import { compareBump, maxBump, type BumpType } from "./changeset.js";
import type { ReleaseKind } from "./classify.js";

export type PackageCategory =
  "infrastructure" | "themes" | "plugins" | "tools" | "core";

/** Release ordering tier when the dependency graph leaves a choice. */
export const CATEGORY_TIER: Record<PackageCategory, number> = {
  infrastructure: 0,
  themes: 1,
  plugins: 2,
  tools: 3,
  core: 4,
};

export type DependencyKind =
  | "dependencies"
  | "peerDependencies"
  | "optionalDependencies"
  | "devDependencies";

export const RUNTIME_DEPENDENCY_KINDS: DependencyKind[] = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

export interface WorkspacePackage {
  /** Directory name under repos/. */
  repo: string;
  /** npm package name. */
  name: string;
  version: string;
  category: PackageCategory;
  kind: ReleaseKind;
  /** "owner/name" on GitHub, if known. */
  githubRepo?: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** Highest bump in pending changesets for this package. */
  pendingBump?: BumpType;
  /** Local version is ahead of npm (bumped, not yet published). */
  unpublishedVersion?: boolean;
}

export function resolvePackage(
  packages: WorkspacePackage[],
  query: string,
): WorkspacePackage | undefined {
  return (
    packages.find((pkg) => pkg.repo === query) ??
    packages.find((pkg) => pkg.name === query) ??
    packages.find((pkg) => pkg.name === `@quartz-community/${query}`)
  );
}

/** Workspace-internal edges: name -> names it depends on (all kinds). */
export function internalDependencies(
  pkg: WorkspacePackage,
  names: ReadonlySet<string>,
  kinds: DependencyKind[] = [...RUNTIME_DEPENDENCY_KINDS, "devDependencies"],
): string[] {
  const deps = new Set<string>();
  for (const kind of kinds) {
    for (const dep of Object.keys(pkg[kind] ?? {})) {
      if (dep !== pkg.name && names.has(dep)) deps.add(dep);
    }
  }
  return [...deps].sort();
}

export class DependencyCycleError extends Error {
  constructor(public readonly members: string[]) {
    super(`dependency cycle between: ${members.join(", ")}`);
    this.name = "DependencyCycleError";
  }
}

/**
 * Topologically orders `subset` (npm names) so dependencies come before
 * dependents. Edges are taken from the full workspace, restricted to the
 * subset. Ties are broken by category tier, then name. Also returns a "wave"
 * per package: packages in the same wave do not depend on each other and can
 * be released in parallel.
 */
export function topoSort(
  packages: WorkspacePackage[],
  subset: Iterable<string>,
): { order: string[]; waves: Map<string, number> } {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const members = new Set(subset);
  for (const name of members) {
    if (!byName.has(name)) throw new Error(`unknown package: ${name}`);
  }
  const deps = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const name of members) {
    const list = internalDependencies(byName.get(name)!, members);
    deps.set(name, list);
    indegree.set(name, list.length);
    for (const dep of list) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), name]);
    }
  }

  const waves = new Map<string, number>();
  const compare = (a: string, b: string) => {
    const waveDiff = (waves.get(a) ?? 0) - (waves.get(b) ?? 0);
    if (waveDiff !== 0) return waveDiff;
    const tierDiff =
      CATEGORY_TIER[byName.get(a)!.category] -
      CATEGORY_TIER[byName.get(b)!.category];
    if (tierDiff !== 0) return tierDiff;
    return a.localeCompare(b);
  };

  const ready = [...members].filter((name) => indegree.get(name) === 0);
  for (const name of ready) waves.set(name, 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(compare);
    const next = ready.shift()!;
    order.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      waves.set(
        dependent,
        Math.max(waves.get(dependent) ?? 0, (waves.get(next) ?? 0) + 1),
      );
      const remaining = indegree.get(dependent)! - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }

  if (order.length !== members.size) {
    throw new DependencyCycleError(
      [...members].filter((name) => !order.includes(name)).sort(),
    );
  }
  return { order, waves };
}

export interface RangeUpdate {
  dependency: string;
  kind: DependencyKind;
  from: string;
  to: string;
}

export type ReleaseReason = "requested" | "dependency-out-of-range";

export interface PlannedRelease {
  repo: string;
  name: string;
  kind: ReleaseKind;
  category: PackageCategory;
  githubRepo?: string;
  from: string;
  /** Version that will be published (equal to `from` when already bumped). */
  to: string;
  /** null when the local version is already bumped and only needs publishing. */
  bump: BumpType | null;
  reasons: ReleaseReason[];
  triggeredBy: string[];
  /** Range edits required in this package's package.json. */
  rangeUpdates: RangeUpdate[];
  /** Range edits recommended (dependency gets new features this one may use). */
  suggestedRangeUpdates: RangeUpdate[];
  hasPendingChangeset: boolean;
  wave: number;
}

export interface AffectedDependent {
  repo: string;
  name: string;
  dependency: string;
  range: string;
  kind: DependencyKind;
}

export interface ReleasePlan {
  releases: PlannedRelease[];
  /** Dependents that stay in range (pick the release up via caret) — verify them. */
  affected: AffectedDependent[];
  /** Private consumers (Quartz core) that need range edits / lockfile refresh. */
  consumerUpdates: Array<{
    repo: string;
    name: string;
    rangeUpdates: RangeUpdate[];
  }>;
  advisories: string[];
  lockfileUpdate: boolean;
}

export interface PlanRequest {
  query: string;
  bump?: BumpType;
}

function bumpFor(
  kind: DependencyKind,
  dependencyBump: BumpType | null,
): BumpType {
  // A peer dependency moving to a new major is breaking for consumers of the
  // dependent (they must install the new peer). Everything else is a patch,
  // which matches what changesets does for internal dependency updates.
  if (kind === "peerDependencies" && dependencyBump === "major") return "major";
  return "patch";
}

function nextVersion(version: string, bump: BumpType): string {
  const next = semver.inc(version, bump);
  if (!next) throw new Error(`cannot bump invalid version ${version}`);
  return next;
}

export function rangeFor(version: string): string {
  return `^${version}`;
}

/**
 * Computes the release set for the requested packages: their own releases plus
 * every dependent whose declared range would no longer accept the new version
 * (transitively), in dependency order.
 */
export function computeReleasePlan(
  packages: WorkspacePackage[],
  requests: PlanRequest[],
): ReleasePlan {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const advisories: string[] = [];

  interface Draft {
    pkg: WorkspacePackage;
    bump: BumpType | null;
    reasons: Set<ReleaseReason>;
    triggeredBy: Set<string>;
    rangeUpdates: Map<string, RangeUpdate>;
    suggested: Map<string, RangeUpdate>;
  }
  const drafts = new Map<string, Draft>();
  const consumerUpdates = new Map<string, Map<string, RangeUpdate>>();
  const affected = new Map<string, AffectedDependent>();

  const versionOf = (draft: Draft) =>
    draft.bump === null
      ? draft.pkg.version
      : nextVersion(draft.pkg.version, draft.bump);

  const ensureDraft = (pkg: WorkspacePackage): Draft => {
    let draft = drafts.get(pkg.name);
    if (!draft) {
      draft = {
        pkg,
        bump: pkg.unpublishedVersion ? null : (pkg.pendingBump ?? null),
        reasons: new Set(),
        triggeredBy: new Set(),
        rangeUpdates: new Map(),
        suggested: new Map(),
      };
      drafts.set(pkg.name, draft);
    }
    return draft;
  };

  /** Raises a draft's bump (never for already-bumped, unpublished packages). */
  const raise = (draft: Draft, bump: BumpType): void => {
    if (draft.pkg.unpublishedVersion) return;
    draft.bump = (maxBump(draft.bump ?? undefined, bump) ?? bump) as BumpType;
  };

  const requestedNames = new Set<string>();
  for (const request of requests) {
    const pkg = resolvePackage(packages, request.query);
    if (!pkg) throw new Error(`unknown package: ${request.query}`);
    if (pkg.kind === "private") {
      throw new Error(
        `${pkg.name} is private and never published; plan the packages it consumes instead`,
      );
    }
    requestedNames.add(pkg.name);
    const draft = ensureDraft(pkg);
    draft.reasons.add("requested");
    if (pkg.unpublishedVersion) {
      advisories.push(
        `${pkg.name}@${pkg.version} is already bumped locally but not on npm; it will be published as-is${request.bump ? ` (ignoring --bump ${request.bump})` : ""}`,
      );
    } else if (request.bump) {
      if (pkg.pendingBump && compareBump(pkg.pendingBump, request.bump) > 0) {
        advisories.push(
          `${pkg.name}: pending changeset already requests ${pkg.pendingBump} (> --bump ${request.bump}); using ${pkg.pendingBump}`,
        );
      }
      raise(draft, request.bump);
    } else if (!draft.bump) {
      draft.bump = "patch";
    }
  }

  // Fixpoint: propagate version changes to dependents until nothing changes.
  const queue: string[] = [];
  const processed = new Map<string, string>();
  const enqueue = (name: string) => {
    const draft = drafts.get(name)!;
    if (processed.get(name) !== versionOf(draft) && !queue.includes(name)) {
      queue.push(name);
    }
  };
  for (const name of drafts.keys()) enqueue(name);
  while (queue.length > 0) {
    const name = queue.shift()!;
    const draft = drafts.get(name)!;
    const newVersion = versionOf(draft);
    processed.set(name, newVersion);
    for (const dependent of packages) {
      if (dependent.name === name) continue;
      for (const kind of [
        ...RUNTIME_DEPENDENCY_KINDS,
        "devDependencies",
      ] as DependencyKind[]) {
        const range = dependent[kind]?.[name];
        if (range === undefined) continue;
        const inRange =
          semver.validRange(range) !== null &&
          semver.satisfies(newVersion, range, { includePrerelease: false });
        const key = `${dependent.name}|${name}|${kind}`;
        if (inRange) {
          const dependentDraft = drafts.get(dependent.name);
          const minimum = semver.minVersion(range);
          if (
            dependentDraft?.reasons.has("requested") &&
            kind !== "devDependencies" &&
            draft.bump !== null &&
            draft.bump !== "patch" &&
            minimum &&
            semver.lt(minimum, newVersion)
          ) {
            dependentDraft.suggested.set(name, {
              dependency: name,
              kind,
              from: range,
              to: rangeFor(newVersion),
            });
          }
          if (!drafts.has(dependent.name) && kind !== "devDependencies") {
            affected.set(key, {
              repo: dependent.repo,
              name: dependent.name,
              dependency: name,
              range,
              kind,
            });
          }
          continue;
        }

        const update: RangeUpdate = {
          dependency: name,
          kind,
          from: range,
          to: rangeFor(newVersion),
        };
        if (kind === "devDependencies") {
          advisories.push(
            `${dependent.name}: devDependency ${name}@${range} excludes ${newVersion}; update it to ${update.to} (no release needed for that alone)`,
          );
          continue;
        }
        if (dependent.kind === "private") {
          const updates = consumerUpdates.get(dependent.name) ?? new Map();
          updates.set(name, update);
          consumerUpdates.set(dependent.name, updates);
          continue;
        }
        affected.delete(key);
        const dependentDraft = ensureDraft(dependent);
        dependentDraft.reasons.add("dependency-out-of-range");
        dependentDraft.triggeredBy.add(name);
        dependentDraft.rangeUpdates.set(name, update);
        if (dependent.unpublishedVersion) {
          advisories.push(
            `${dependent.name}@${dependent.version} is bumped but unpublished and needs its ${name} range raised to ${update.to} before publishing`,
          );
        } else {
          raise(dependentDraft, bumpFor(kind, draft.bump));
          if (dependentDraft.bump === null) dependentDraft.bump = "patch";
        }
        enqueue(dependent.name);
      }
    }
  }

  // Pre-existing breakage worth surfacing: ranges that already exclude the
  // current local version of a released package.
  for (const draft of drafts.values()) {
    for (const kind of RUNTIME_DEPENDENCY_KINDS) {
      for (const [dep, range] of Object.entries(draft.pkg[kind] ?? {})) {
        const depPkg = byName.get(dep);
        if (!depPkg || drafts.has(dep) || draft.rangeUpdates.has(dep)) continue;
        if (
          semver.validRange(range) &&
          !semver.satisfies(depPkg.version, range, { includePrerelease: false })
        ) {
          advisories.push(
            `${draft.pkg.name}: ${kind} ${dep}@${range} does not include the workspace version ${depPkg.version}`,
          );
        }
      }
    }
  }

  const { order, waves } = topoSort(packages, drafts.keys());
  const releases: PlannedRelease[] = order.map((name) => {
    const draft = drafts.get(name)!;
    const bump = draft.pkg.unpublishedVersion ? null : (draft.bump ?? "patch");
    return {
      repo: draft.pkg.repo,
      name,
      kind: draft.pkg.kind,
      category: draft.pkg.category,
      githubRepo: draft.pkg.githubRepo,
      from: draft.pkg.version,
      to:
        bump === null
          ? draft.pkg.version
          : nextVersion(draft.pkg.version, bump),
      bump,
      reasons: [...draft.reasons],
      triggeredBy: [...draft.triggeredBy].sort(),
      rangeUpdates: [...draft.rangeUpdates.values()],
      suggestedRangeUpdates: [...draft.suggested.values()],
      hasPendingChangeset: draft.pkg.pendingBump !== undefined,
      wave: waves.get(name) ?? 0,
    };
  });

  const releasedNames = new Set(drafts.keys());
  const affectedList = [...affected.values()]
    .filter((entry) => !releasedNames.has(entry.name))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.dependency.localeCompare(b.dependency),
    );

  const npmReleases = releases.filter(
    (release) => release.kind === "changesets" || release.kind === "tag",
  );
  for (const release of releases) {
    if (release.kind === "github-release") {
      advisories.push(
        `${release.name} is released through GitHub releases (not npm); follow repos/${release.repo}/AGENTS.md`,
      );
    }
  }
  for (const release of releases) {
    if (release.bump !== "major") continue;
    const patched = releases.filter(
      (other) =>
        other.bump === "patch" &&
        other.triggeredBy.includes(release.name) &&
        !other.reasons.includes("requested"),
    );
    if (patched.length > 0) {
      advisories.push(
        `${release.name} goes major: ${patched.length} dependent(s) get a patch release for the range bump only; raise any whose public API exposes ${release.name}'s breaking change`,
      );
    }
  }
  if (requestedNames.size === 0) advisories.push("no packages requested");

  return {
    releases,
    affected: affectedList,
    consumerUpdates: [...consumerUpdates.entries()].map(([name, updates]) => ({
      repo: byName.get(name)!.repo,
      name,
      rangeUpdates: [...updates.values()],
    })),
    advisories: [...new Set(advisories)],
    lockfileUpdate: npmReleases.length > 0,
  };
}
