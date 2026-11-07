import semver from "semver";

/**
 * How a repository gets its releases out:
 * - changesets: push a changeset to main -> CI opens "chore: version package"
 *   PR -> merging it publishes to npm (and tags v<version>).
 * - tag: bump package.json version, push a `v<version>` tag -> CI publishes.
 * - github-release: not on npm; pushing a version tag builds a GitHub release
 *   (Quartz Syncer).
 * - private: never published (Quartz core) — only consumes releases.
 */
export type ReleaseKind = "changesets" | "tag" | "github-release" | "private";

export type ReleaseStatus =
  | "clean"
  | "needs-changeset"
  | "needs-version-bump"
  | "ready"
  | "version-bumped-unpublished"
  | "npm-ahead"
  | "dirty"
  | "lockfile-stale"
  | "unknown";

/** Paths that never change what consumers install from npm. */
const NON_RELEASE_PATTERNS: RegExp[] = [
  /^(test|tests|__tests__|__mocks__|e2e|docs|examples?|fixtures|bench|benchmarks?|test-vault|\.github|\.changeset|\.husky|\.vscode|\.idea|\.turbo|coverage|node_modules|dist)\//,
  /(^|\/)(__tests__|__mocks__|__snapshots__)\//,
  /(^|\/)\.[^/]*cache[^/]*\//i, // .quartz-cache/, .cache/, .eslintcache dirs
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(README|CHANGELOG|CONTRIBUTING|LICENSE|AGENTS|CLAUDE|CODE_OF_CONDUCT|SECURITY)(\.[A-Za-z]+)?$/i,
  /^[^/]+\.md$/i,
  /^\.[^/]+$/, // root dotfiles: .gitignore, .prettierrc, .eslintrc.json, .npmrc, ...
  /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /^tsconfig\.json$/,
  /^(vitest|vite|jest|playwright|eslint|prettier|wdio)(\.[a-z]+)*\.config\.[cm]?[jt]s$/,
  /^(vitest|jest|playwright|wdio)\.[a-z.]*\.?[cm]?[jt]s$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^(flake\.nix|flake\.lock|justfile|Justfile|renovate\.json)$/,
];

/**
 * Whether a changed file can affect the published package. Unknown paths are
 * treated as releasable (conservative). package.json is special-cased by
 * `packageJsonReleasableChanges`.
 */
export function isReleasablePath(path: string): boolean {
  if (path === "package.json") return true;
  return !NON_RELEASE_PATTERNS.some((pattern) => pattern.test(path));
}

/** package.json fields whose change alters what consumers get. */
export const RELEASABLE_PACKAGE_FIELDS = [
  "name",
  "type",
  "main",
  "module",
  "types",
  "typings",
  "exports",
  "imports",
  "bin",
  "files",
  "sideEffects",
  "engines",
  "dependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
  "quartz",
] as const;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Returns the releasable package.json fields that differ (version excluded). */
export function packageJsonReleasableChanges(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string[] {
  const a = before ?? {};
  const b = after ?? {};
  return RELEASABLE_PACKAGE_FIELDS.filter(
    (field) => stableStringify(a[field]) !== stableStringify(b[field]),
  );
}

export interface ClassifyInput {
  kind: ReleaseKind;
  localVersion: string;
  /** undefined = not checked (offline); null = not published on npm. */
  npmLatest?: string | null;
  /** Whether a git tag exists for the local version (offline fallback). */
  versionTagExists: boolean;
  dirtyReleasableFiles: string[];
  releasableCommitCount: number;
  pendingChangesetCount: number;
  unpushedCount: number | null;
  /** Quartz core only: ecosystem packages whose lockfile entry < npm latest. */
  staleLockEntries?: string[];
}

export interface Classification {
  status: ReleaseStatus;
  next: string;
}

function validVersion(raw: string | null | undefined): string | null {
  return raw ? semver.valid(raw) : null;
}

export function classifyStatus(input: ClassifyInput): Classification {
  const local = validVersion(input.localVersion);
  const npm = validVersion(input.npmLatest);

  if (input.kind === "private") {
    if (input.dirtyReleasableFiles.length > 0) {
      return { status: "dirty", next: "commit or discard local changes" };
    }
    if (input.staleLockEntries && input.staleLockEntries.length > 0) {
      return {
        status: "lockfile-stale",
        next: "just update-quartz-lockfile (then push)",
      };
    }
    return { status: "clean", next: "-" };
  }

  if (!local)
    return { status: "unknown", next: "package.json has no valid version" };

  if (npm && semver.gt(npm, local)) {
    return {
      status: "npm-ahead",
      next: "pull: npm has a newer version than the local checkout",
    };
  }

  if (input.dirtyReleasableFiles.length > 0) {
    return {
      status: "dirty",
      next: "commit (just commit) or discard uncommitted source changes",
    };
  }

  const usesNpm = input.kind === "changesets" || input.kind === "tag";
  const unpublished = usesNpm
    ? input.npmLatest === null ||
      (npm !== null ? semver.gt(local, npm) : !input.versionTagExists)
    : !input.versionTagExists;
  if (unpublished) {
    const next =
      input.kind === "changesets"
        ? "version bumped but not on npm: check the Release CI run"
        : input.kind === "tag"
          ? `push the release tag (just publish-tag)`
          : "push the version tag to build the GitHub release";
    return { status: "version-bumped-unpublished", next };
  }

  if (input.pendingChangesetCount > 0) {
    const next =
      input.unpushedCount === null || input.unpushedCount > 0
        ? "commit + push the changeset (just commit / just push-repo)"
        : "merge the 'chore: version package' PR (or check it was opened)";
    return { status: "ready", next };
  }

  if (input.releasableCommitCount > 0) {
    if (input.kind === "changesets") {
      return {
        status: "needs-changeset",
        next: "release.ts changeset --bump <type> --summary ...",
      };
    }
    return {
      status: "needs-version-bump",
      next:
        input.kind === "tag"
          ? "bump package.json version, then just publish-tag"
          : "bump version (version-bump.mjs) and tag",
    };
  }

  return { status: "clean", next: "-" };
}
