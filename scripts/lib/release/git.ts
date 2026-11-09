import { runCommandCapture, TIMEOUTS } from "../exec.js";

const GIT_OPTIONS = { timeout: TIMEOUTS.GIT_OP };

async function git(repoPath: string, args: string[]): Promise<string> {
  return runCommandCapture("git", args, repoPath, false, GIT_OPTIONS);
}

async function gitOrNull(
  repoPath: string,
  args: string[],
): Promise<string | null> {
  try {
    return await git(repoPath, args);
  } catch {
    return null;
  }
}

export async function currentBranch(repoPath: string): Promise<string> {
  return (
    (await gitOrNull(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "?"
  );
}

/** Uncommitted paths (tracked changes + untracked), excluding dist/ and .turbo/. */
export async function dirtyFiles(repoPath: string): Promise<string[]> {
  const output = await git(repoPath, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
    ":!dist/",
    ":!.turbo/",
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // runCommandCapture trims output, so the first line may have lost the
      // leading space of its status code — parse instead of slicing.
      const path = line.replace(/^\s*\S{1,2}\s+/, "");
      const arrow = path.indexOf(" -> ");
      return (arrow >= 0 ? path.slice(arrow + 4) : path).replace(/^"|"$/g, "");
    });
}

/** Commits on HEAD not on the upstream (as of the last fetch). null = no upstream. */
export async function aheadBehind(
  repoPath: string,
): Promise<{ ahead: number | null; behind: number | null }> {
  const output = await gitOrNull(repoPath, [
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...@{u}",
  ]);
  if (!output) return { ahead: null, behind: null };
  const [ahead, behind] = output.split(/\s+/).map(Number);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

export async function isShallow(repoPath: string): Promise<boolean> {
  return (
    (await gitOrNull(repoPath, ["rev-parse", "--is-shallow-repository"])) ===
    "true"
  );
}

async function isAncestor(repoPath: string, commit: string): Promise<boolean> {
  return (
    (await gitOrNull(repoPath, [
      "merge-base",
      "--is-ancestor",
      commit,
      "HEAD",
    ])) !== null
  );
}

export async function tagCommit(
  repoPath: string,
  tag: string,
): Promise<string | null> {
  return gitOrNull(repoPath, ["rev-list", "-n", "1", `refs/tags/${tag}`]);
}

export function versionTagCandidates(name: string, version: string): string[] {
  return [`v${version}`, version, `${name}@${version}`];
}

export async function findVersionTag(
  repoPath: string,
  name: string,
  version: string,
): Promise<{ tag: string; commit: string } | null> {
  for (const tag of versionTagCandidates(name, version)) {
    const commit = await tagCommit(repoPath, tag);
    if (commit) return { tag, commit };
  }
  return null;
}

export async function readFileAt(
  repoPath: string,
  commit: string,
  path: string,
): Promise<string | null> {
  return gitOrNull(repoPath, ["show", `${commit}:${path}`]);
}

async function versionAt(
  repoPath: string,
  commit: string,
): Promise<string | null> {
  const raw = await readFileAt(repoPath, commit, "package.json");
  if (!raw) return null;
  try {
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

export interface ReleaseBase {
  commit: string;
  /** How it was found: "tag:<name>" or "version-commit". */
  source: string;
  /** True when the history is shallow and the base may be older than found. */
  approximate: boolean;
}

/**
 * The commit that released the current version: its tag (v<version>,
 * <version>, or <name>@<version>) when that is an ancestor of HEAD, otherwise
 * the oldest commit of the newest run of package.json revisions carrying the
 * current version (i.e. the commit that set it).
 */
export async function findReleaseBase(
  repoPath: string,
  name: string,
  version: string,
): Promise<ReleaseBase | null> {
  const tag = await findVersionTag(repoPath, name, version);
  if (tag && (await isAncestor(repoPath, tag.commit))) {
    return { commit: tag.commit, source: `tag:${tag.tag}`, approximate: false };
  }

  const log = await gitOrNull(repoPath, [
    "log",
    "--format=%H",
    "-n",
    "100",
    "--",
    "package.json",
  ]);
  if (!log) return null;
  const commits = log.split("\n").filter(Boolean);
  let base: string | null = null;
  let reachedEnd = true;
  for (const commit of commits) {
    const atCommit = await versionAt(repoPath, commit);
    if (atCommit === version) {
      base = commit;
      continue;
    }
    if (base) {
      reachedEnd = false;
      break;
    }
    // HEAD's package.json has a different version than the newest commit that
    // touched it — can only happen with uncommitted edits; keep scanning.
  }
  if (!base) return null;
  const shallow = reachedEnd && (await isShallow(repoPath));
  return { commit: base, source: "version-commit", approximate: shallow };
}

export interface CommitInfo {
  hash: string;
  subject: string;
  files: string[];
}

export async function commitsSince(
  repoPath: string,
  base: string,
): Promise<CommitInfo[]> {
  const SEP = "\u001e";
  const output = await git(repoPath, [
    "log",
    `--format=${SEP}%h%x09%s`,
    "--name-only",
    `${base}..HEAD`,
  ]);
  return output
    .split(SEP)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [header, ...files] = chunk.split("\n");
      const [hash, ...subject] = header.split("\t");
      return {
        hash,
        subject: subject.join("\t"),
        files: files.filter(Boolean),
      };
    });
}
