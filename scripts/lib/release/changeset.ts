import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const BUMP_TYPES = ["patch", "minor", "major"] as const;
export type BumpType = (typeof BUMP_TYPES)[number];
/** Changesets also allows `none` in frontmatter (no release for that package). */
export type ChangesetBump = BumpType | "none";

const BUMP_RANK: Record<ChangesetBump, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

export function isBumpType(value: unknown): value is BumpType {
  return (
    typeof value === "string" &&
    (BUMP_TYPES as readonly string[]).includes(value)
  );
}

/** Returns the larger of two bumps (`undefined` counts as "nothing"). */
export function maxBump(
  a: ChangesetBump | undefined,
  b: ChangesetBump | undefined,
): ChangesetBump | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b;
}

export function compareBump(a: ChangesetBump, b: ChangesetBump): number {
  return BUMP_RANK[a] - BUMP_RANK[b];
}

export interface ChangesetRelease {
  name: string;
  bump: ChangesetBump;
}

export interface ParsedChangeset {
  releases: ChangesetRelease[];
  summary: string;
}

export interface PendingChangeset extends ParsedChangeset {
  file: string;
}

export class ChangesetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangesetParseError";
  }
}

/**
 * Parses a changeset markdown file:
 *
 * ---
 * "@scope/name": minor
 * ---
 *
 * Summary text
 */
export function parseChangeset(content: string): ParsedChangeset {
  const normalized = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(
    /^\s*---\n([\s\S]*?)\n?---[ \t]*(?:\n|$)([\s\S]*)$/,
  );
  if (!match) {
    throw new ChangesetParseError("missing frontmatter block (--- ... ---)");
  }
  const releases: ChangesetRelease[] = [];
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const lineMatch = line.match(
      /^(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:\s*(major|minor|patch|none)\s*$/,
    );
    if (!lineMatch) {
      throw new ChangesetParseError(`invalid frontmatter line: ${line}`);
    }
    releases.push({
      name: lineMatch[1] ?? lineMatch[2] ?? lineMatch[3],
      bump: lineMatch[4] as ChangesetBump,
    });
  }
  return { releases, summary: match[2].trim() };
}

export function renderChangeset(
  releases: ChangesetRelease[],
  summary: string,
): string {
  if (releases.length === 0) {
    throw new Error("a changeset needs at least one release entry");
  }
  const trimmed = summary.trim();
  if (!trimmed) throw new Error("a changeset needs a non-empty summary");
  const lines = releases.map(({ name, bump }) => `"${name}": ${bump}`);
  return `---\n${lines.join("\n")}\n---\n\n${trimmed}\n`;
}

/** Turns a summary into a filesystem-safe changeset file stem. */
export function slugify(text: string, maxLength = 48): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "changeset";
}

/** Picks `<slug>.md`, or `<slug>-2.md`, ... when that name is taken. */
export function uniqueChangesetFile(
  slug: string,
  existing: ReadonlySet<string>,
): string {
  let candidate = `${slug}.md`;
  for (let i = 2; existing.has(candidate); i += 1) {
    candidate = `${slug}-${i}.md`;
  }
  return candidate;
}

function isChangesetFileName(file: string): boolean {
  return file.endsWith(".md") && file.toLowerCase() !== "readme.md";
}

export interface ReadChangesetsResult {
  hasChangesetDir: boolean;
  pending: PendingChangeset[];
  errors: Array<{ file: string; error: string }>;
}

export function readPendingChangesets(repoPath: string): ReadChangesetsResult {
  const dir = join(repoPath, ".changeset");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { hasChangesetDir: false, pending: [], errors: [] };
  }
  const pending: PendingChangeset[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  for (const file of readdirSync(dir).sort()) {
    if (!isChangesetFileName(file)) continue;
    try {
      const parsed = parseChangeset(readFileSync(join(dir, file), "utf-8"));
      pending.push({ file, ...parsed });
    } catch (error) {
      errors.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { hasChangesetDir: true, pending, errors };
}

/** Highest bump requested for `packageName` across pending changesets. */
export function pendingBumpFor(
  pending: PendingChangeset[],
  packageName: string,
): ChangesetBump | undefined {
  let result: ChangesetBump | undefined;
  for (const changeset of pending) {
    for (const release of changeset.releases) {
      if (release.name === packageName) result = maxBump(result, release.bump);
    }
  }
  return result;
}

export interface WriteChangesetOptions {
  repoPath: string;
  packageName: string;
  bump: BumpType;
  summary: string;
  name?: string;
  dryRun?: boolean;
}

export interface WriteChangesetResult {
  path: string;
  content: string;
  written: boolean;
}

export function writeChangeset(
  options: WriteChangesetOptions,
): WriteChangesetResult {
  const dir = join(options.repoPath, ".changeset");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `${options.repoPath} has no .changeset directory; this repo does not release via changesets`,
    );
  }
  if (!isBumpType(options.bump)) {
    throw new Error(`invalid bump type: ${String(options.bump)}`);
  }
  const content = renderChangeset(
    [{ name: options.packageName, bump: options.bump }],
    options.summary,
  );
  const existing = new Set(readdirSync(dir));
  const file = uniqueChangesetFile(
    slugify(options.name ?? options.summary),
    existing,
  );
  const path = join(dir, file);
  if (!options.dryRun) writeFileSync(path, content, { flag: "wx" });
  return { path, content, written: !options.dryRun };
}
