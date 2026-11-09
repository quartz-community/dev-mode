import { existsSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { safeReadJson } from "../json.js";
import {
  classifyStatus,
  isReleasablePath,
  packageJsonReleasableChanges,
  type ReleaseKind,
  type ReleaseStatus,
} from "./classify.js";
import {
  aheadBehind,
  commitsSince,
  currentBranch,
  dirtyFiles,
  findReleaseBase,
  findVersionTag,
  readFileAt,
} from "./git.js";
import type { NpmInfo } from "./npm.js";
import type { LoadedPackage } from "./workspace.js";

export interface RepoReleaseStatus {
  repo: string;
  name: string;
  kind: ReleaseKind;
  category: string;
  localVersion: string;
  /** undefined when --offline; null when not on npm. */
  npmLatest?: string | null;
  npmError?: string;
  branch: string;
  dirty: boolean;
  dirtyFiles: string[];
  dirtyReleasableFiles: string[];
  unpushed: number | null;
  behind: number | null;
  releaseBase: { commit: string; source: string; approximate: boolean } | null;
  versionTag: string | null;
  commitsSinceRelease: Array<{
    hash: string;
    subject: string;
    releasable: boolean;
  }>;
  releasableCommitCount: number;
  releasableFiles: string[];
  packageJsonChanges: string[];
  pendingChangesets: Array<{
    file: string;
    bump: string | null;
    summary: string;
  }>;
  changesetErrors: Array<{ file: string; error: string }>;
  staleLockEntries?: string[];
  status: ReleaseStatus;
  next: string;
}

function parseJson(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export interface LockFile {
  packages?: Record<string, { version?: string }>;
}

/**
 * Ecosystem packages whose entry in a package-lock.json is older than the
 * newest published version in the same caret range — i.e. what
 * `just update-quartz-lockfile` would pick up. Newer majors are reported
 * separately in the text (they need a range edit, not just a lockfile refresh).
 */
export function staleLockEntriesFrom(
  lock: LockFile,
  npm: Map<string, NpmInfo>,
): string[] {
  const stale: string[] = [];
  for (const [name, info] of npm) {
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    if (!locked || !semver.valid(locked)) continue;
    const inRange = semver.maxSatisfying(info.versions, `^${locked}`);
    const latest =
      info.latest && semver.valid(info.latest) ? info.latest : null;
    const majorNote =
      latest && semver.major(latest) > semver.major(locked)
        ? ` (npm latest ${latest}: new major, needs a range change)`
        : "";
    if (inRange && semver.gt(inRange, locked)) {
      stale.push(`${name} ${locked} -> ${inRange}${majorNote}`);
    }
  }
  return stale.sort();
}

export function staleLockEntries(
  lockfilePath: string,
  npm: Map<string, NpmInfo>,
): string[] {
  if (!existsSync(lockfilePath)) return [];
  return staleLockEntriesFrom(safeReadJson<LockFile>(lockfilePath), npm);
}

export async function collectRepoStatus(
  pkg: LoadedPackage,
  npm: { info?: NpmInfo; error?: string; all?: Map<string, NpmInfo> },
): Promise<RepoReleaseStatus> {
  const [branch, dirty, { ahead, behind }] = await Promise.all([
    currentBranch(pkg.path),
    dirtyFiles(pkg.path),
    aheadBehind(pkg.path),
  ]);
  const base = await findReleaseBase(pkg.path, pkg.name, pkg.version);
  const tag = await findVersionTag(pkg.path, pkg.name, pkg.version);

  let commits: Array<{ hash: string; subject: string; releasable: boolean }> =
    [];
  let releasableFiles: string[] = [];
  let packageJsonChanges: string[] = [];
  if (base) {
    const raw = await commitsSince(pkg.path, base.commit);
    const basePackage = parseJson(
      await readFileAt(pkg.path, base.commit, "package.json"),
    );
    const headPackage = parseJson(
      await readFileAt(pkg.path, "HEAD", "package.json"),
    );
    packageJsonChanges = packageJsonReleasableChanges(basePackage, headPackage);
    const fileReleasable = (file: string) =>
      file === "package.json"
        ? packageJsonChanges.length > 0
        : isReleasablePath(file);
    commits = raw.map((commit) => ({
      hash: commit.hash,
      subject: commit.subject,
      releasable: commit.files.some(fileReleasable),
    }));
    releasableFiles = [...new Set(raw.flatMap((commit) => commit.files))]
      .filter(fileReleasable)
      .sort();
  }

  const dirtyReleasableFiles = dirty.filter(
    (file) => file !== "package.json" && isReleasablePath(file),
  );
  if (dirty.includes("package.json")) {
    const headPackage = parseJson(
      await readFileAt(pkg.path, "HEAD", "package.json"),
    );
    if (packageJsonReleasableChanges(headPackage, pkg.packageJson).length > 0) {
      dirtyReleasableFiles.push("package.json");
    }
  }

  const stale =
    pkg.kind === "private" && npm.all
      ? staleLockEntries(join(pkg.path, "package-lock.json"), npm.all)
      : undefined;

  const pending = pkg.pendingChangesets.pending.map((changeset) => ({
    file: changeset.file,
    bump:
      changeset.releases.find((release) => release.name === pkg.name)?.bump ??
      null,
    summary: changeset.summary.split("\n")[0],
  }));
  const releasableCommitCount = commits.filter(
    (commit) => commit.releasable,
  ).length;
  const npmLatest = npm.error
    ? undefined
    : npm.info
      ? npm.info.latest
      : undefined;

  const classification = classifyStatus({
    kind: pkg.kind,
    localVersion: pkg.version,
    npmLatest,
    versionTagExists: tag !== null,
    dirtyReleasableFiles,
    releasableCommitCount,
    pendingChangesetCount: pending.filter((p) => p.bump && p.bump !== "none")
      .length,
    unpushedCount: ahead,
    staleLockEntries: stale,
  });

  return {
    repo: pkg.repo,
    name: pkg.name,
    kind: pkg.kind,
    category: pkg.category,
    localVersion: pkg.version,
    npmLatest:
      pkg.kind === "private" || pkg.kind === "github-release"
        ? undefined
        : npmLatest,
    npmError: npm.error,
    branch,
    dirty: dirty.length > 0,
    dirtyFiles: dirty,
    dirtyReleasableFiles,
    unpushed: ahead,
    behind,
    releaseBase: base,
    versionTag: tag?.tag ?? null,
    commitsSinceRelease: commits,
    releasableCommitCount,
    releasableFiles,
    packageJsonChanges,
    pendingChangesets: pending,
    changesetErrors: pkg.pendingChangesets.errors,
    staleLockEntries: stale,
    status: classification.status,
    next: classification.next,
  };
}
