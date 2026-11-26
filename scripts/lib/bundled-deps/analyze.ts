/**
 * Which ecosystem packages a plugin bundles, at which version, and whether
 * that copy is older than the latest published one. Pure functions only (no
 * I/O) so tests can feed fixtures; `sources.ts` does the fetching.
 *
 * Why: plugins bundle every dependency at build time (tsup
 * `noExternal: [/.*\/]`) at the version their own package-lock.json pins. A
 * fix released in @quartz-community/utils reaches users only after each
 * plugin bumps its lockfile and releases again; the workspace (pnpm, linked
 * sources) never shows the old copy.
 */
import { posix } from "node:path";
import { gunzipSync } from "node:zlib";
import semver from "semver";
import { matchesIgnore } from "../release/drift.js";

/** Ecosystem packages are always tracked; `--deps` adds others (globs ok). */
export const ECOSYSTEM = /^@quartz-(?:community|themes)\//;
/** Never bundled: Quartz core is the host that loads the plugin. */
const NEVER_TRACKED = /^@jackyzha0\//;

export function isTracked(name: string, extra: string[] = []): boolean {
  if (NEVER_TRACKED.test(name)) return false;
  return ECOSYSTEM.test(name) || matchesIgnore(name, extra);
}

// --------------------------------------------------------------------------
// lockfile
// --------------------------------------------------------------------------

export interface LockEntry {
  version?: string;
  dev?: boolean;
  link?: boolean;
  resolved?: string;
}
export interface BundleLock {
  packages?: Record<string, LockEntry>;
}

export interface LockCopy {
  /** package-lock key, e.g. `node_modules/a/node_modules/@quartz-community/utils`. */
  path: string;
  name: string;
  version: string;
  /** Only reachable through devDependencies: not part of the published install. */
  dev: boolean;
}

/** Package name of a lockfile key / install path (last `node_modules/` segment). */
export function packageNameOfPath(path: string): string | undefined {
  const index = path.lastIndexOf("node_modules/");
  if (index === -1) return undefined;
  const rest = path.slice(index + "node_modules/".length).split("/");
  if (rest[0]?.startsWith("@"))
    return rest[1] ? `${rest[0]}/${rest[1]}` : undefined;
  return rest[0] || undefined;
}

/** Every installed copy of every tracked package (nested duplicates included). */
export function trackedLockCopies(
  lock: BundleLock,
  tracked: (name: string) => boolean,
): LockCopy[] {
  const copies: LockCopy[] = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.includes("node_modules/") || entry.link) continue;
    const name = packageNameOfPath(path);
    if (!name || !tracked(name) || !entry.version) continue;
    if (!semver.valid(entry.version)) continue;
    copies.push({
      path,
      name,
      version: entry.version,
      dev: entry.dev === true,
    });
  }
  return copies.sort(
    (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
  );
}

// --------------------------------------------------------------------------
// source maps → bundled modules
// --------------------------------------------------------------------------

/** name → install path ("" = unknown, e.g. a workspace link) → files (relative to the package root). */
export type BundleModules = Map<string, Map<string, Set<string>>>;

export interface SourceMapFile {
  /** Path of the .map file relative to the package root (e.g. `dist/index.js.map`). */
  path: string;
  sources: string[];
}

function addModule(
  modules: BundleModules,
  name: string,
  installPath: string,
  file: string,
): void {
  let byPath = modules.get(name);
  if (!byPath) modules.set(name, (byPath = new Map()));
  let files = byPath.get(installPath);
  if (!files) byPath.set(installPath, (files = new Set()));
  if (file) files.add(file);
}

/**
 * Turn a resolved source path (relative to the package root, posix) into the
 * package it belongs to. `node_modules/@quartz-community/utils/src/lang.ts` →
 * utils, install path `node_modules/@quartz-community/utils`, file `src/lang.ts`.
 * pnpm's virtual store (`.pnpm/x@1/node_modules/x`) has no lockfile path.
 */
export function parseModuleSource(
  resolved: string,
): { name: string; installPath: string; file: string } | undefined {
  const normalized = resolved.replace(/\\/g, "/");
  const first = normalized.indexOf("node_modules/");
  if (first === -1) return undefined;
  const last = normalized.lastIndexOf("node_modules/");
  const after = normalized.slice(last + "node_modules/".length).split("/");
  const scoped = after[0]?.startsWith("@");
  const nameParts = scoped ? after.slice(0, 2) : after.slice(0, 1);
  if (nameParts.length < (scoped ? 2 : 1) || !nameParts.every(Boolean))
    return undefined;
  const name = nameParts.join("/");
  const file = after.slice(nameParts.length).join("/");
  const installPath = normalized.slice(first, last) + `node_modules/${name}`;
  return {
    name,
    installPath: installPath.includes("/.pnpm/") ? "" : installPath,
    file,
  };
}

/**
 * Modules in a bundle, from its source maps. esbuild chains the dependencies'
 * own source maps, so sources point at the dependency's `src/` files.
 *
 * `workspaceRepos` maps a path prefix (relative to the package root, e.g.
 * `../utils/`) to a package name: in the dev-mode workspace dependencies are
 * linked, so sources look like `../../utils/src/lang.ts`.
 */
export function collectBundleModules(
  maps: SourceMapFile[],
  workspaceRepos: Map<string, string> = new Map(),
): BundleModules {
  const modules: BundleModules = new Map();
  for (const map of maps) {
    const dir = posix.dirname(map.path);
    for (const source of map.sources) {
      if (/^[a-z]+:/i.test(source) && !source.startsWith("file:")) continue;
      const resolved = posix.normalize(
        posix.join(dir, source.replace(/^file:\/\//, "").replace(/\\/g, "/")),
      );
      const parsed = parseModuleSource(resolved);
      if (parsed) {
        addModule(modules, parsed.name, parsed.installPath, parsed.file);
        continue;
      }
      for (const [prefix, name] of workspaceRepos) {
        if (resolved.startsWith(prefix)) {
          addModule(modules, name, "", resolved.slice(prefix.length));
          break;
        }
      }
    }
  }
  return modules;
}

// --------------------------------------------------------------------------
// build config → bundling heuristic (used when there is no source map)
// --------------------------------------------------------------------------

export interface BundleMode {
  /** all: every dependency bundled unless excepted; none: dependencies external. */
  kind: "all" | "none" | "unknown";
  /** Excluded from "all" (negative lookahead / external lists). */
  except: string[];
  /** Explicitly bundled in "none" (noExternal string list). */
  include: string[];
}

function stringLiterals(text: string): string[] {
  return [...text.matchAll(/["'`]([^"'`\s]+)["'`]/g)].map((match) => match[1]);
}

/** Best-effort reading of tsup.config.ts / esbuild.config.mjs text. */
export function detectBundleMode(configText: string | null): BundleMode {
  if (!configText) return { kind: "unknown", except: [], include: [] };
  const text = configText.replace(/\/\/[^\n]*/g, "");
  const except = new Set<string>();
  // external: [...] arrays and const FOO_EXTERNALS = [...] lists.
  for (const match of text.matchAll(
    /(?:external\s*:|EXTERNALS?\s*(?::[^=]+)?=)\s*\[([^\]]*)\]/gi,
  )) {
    for (const literal of stringLiterals(match[1])) except.add(literal);
  }
  const noExternal = text.match(/noExternal\s*:\s*\[([^\]]*)\]/);
  if (noExternal) {
    const body = noExternal[1];
    if (/\/\.\*\//.test(body) || /\/\^\(\?!/.test(body)) {
      const lookahead = body.match(/\/\^\(\?!([^)]*)\)/);
      if (lookahead) {
        for (const part of lookahead[1].split("|")) {
          const name = part.replace(/\\\//g, "/").replace(/[.*$^]+$/, "");
          if (name) except.add(name);
        }
      }
      return { kind: "all", except: [...except], include: [] };
    }
    return { kind: "none", except: [], include: stringLiterals(body) };
  }
  if (/\bbundle\s*:\s*true/.test(text))
    return { kind: "all", except: [...except], include: [] };
  return { kind: "none", except: [], include: [] };
}

function matchesExcept(name: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) =>
      name === pattern ||
      // `@myriaddreamin/` (a negative lookahead) excludes the whole scope
      name.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`) ||
      (pattern.endsWith("*") && name.startsWith(pattern.slice(0, -1))),
  );
}

// --------------------------------------------------------------------------
// comparison
// --------------------------------------------------------------------------

export type BundledStatus =
  /** bundled copy == latest published */
  | "current"
  /** bundled copy older than latest, and the bundled modules differ (or can't be compared) */
  | "stale"
  /** older than latest, but every bundled file is identical in latest */
  | "stale-unaffected"
  /** bundled copy newer than npm latest (unreleased) */
  | "ahead"
  /** in the lockfile but no module of it is in the bundle (types / devDependency) */
  | "types-only"
  /** another copy of the same package is the one bundled */
  | "not-bundled"
  /** left external by the build config: the consumer installs it */
  | "external"
  /** version or latest unknown */
  | "unknown";

export type StaleLevel = "major" | "minor" | "patch" | "prerelease";

export interface ChangelogEntry {
  version: string;
  lines: string[];
}

export interface BundledDep {
  repo: string;
  package: string;
  /** main = lockfile on the default branch (next release); npm = a published tarball. */
  source: "main" | "npm";
  /** For source npm: the plugin version inspected. */
  sourceVersion?: string;
  dependency: string;
  /** Lockfile path of this copy (null when only known from the bundle). */
  path: string | null;
  version: string | null;
  latest: string | null;
  workspace: string | null;
  /** yes = seen in the source map; assumed = from build config + lockfile. */
  bundled: "yes" | "assumed" | "no";
  status: BundledStatus;
  level?: StaleLevel;
  /** Files of the dependency that are in the bundle (when known). */
  files?: string[];
  /** For stale: bundled files that differ between `version` and `latest`. */
  changedFiles?: string[];
  /** Changed declarations (`file#name`) that are present in the bundle. */
  changedSymbols?: string[];
  changelog?: ChangelogEntry[];
  note?: string;
}

export function staleLevel(from: string, to: string): StaleLevel | undefined {
  if (!semver.valid(from) || !semver.valid(to) || !semver.lt(from, to))
    return undefined;
  const diff = semver.diff(from, to);
  if (diff === "major" || diff === "premajor") return "major";
  if (diff === "minor" || diff === "preminor") return "minor";
  if (diff === "patch" || diff === "prepatch") return "patch";
  return "prerelease";
}

export function versionStatus(
  version: string | null,
  latest: string | null,
): { status: BundledStatus; level?: StaleLevel } {
  if (!version || !latest || !semver.valid(version) || !semver.valid(latest))
    return { status: "unknown" };
  if (semver.eq(version, latest)) return { status: "current" };
  if (semver.gt(version, latest)) return { status: "ahead" };
  return { status: "stale", level: staleLevel(version, latest) };
}

export interface EvaluateInput {
  repo: string;
  package: string;
  source: "main" | "npm";
  sourceVersion?: string;
  /** null = no lockfile available (versions unknown). */
  lock: BundleLock | null;
  /** null = no source map: fall back to `mode` + lockfile. */
  modules: BundleModules | null;
  /** Install paths in `modules` are from another lockfile (e.g. a published build): match by name only. */
  modulesByNameOnly?: boolean;
  mode: BundleMode;
  tracked: (name: string) => boolean;
  latest: (name: string) => string | null;
  workspace: (name: string) => string | null;
}

/** One row per installed copy of each tracked dependency. */
export function evaluateBundle(input: EvaluateInput): BundledDep[] {
  const tracked = (name: string) =>
    name !== input.package && input.tracked(name);
  const copies = input.lock ? trackedLockCopies(input.lock, tracked) : [];
  const names = new Set(copies.map((copy) => copy.name));
  for (const name of input.modules?.keys() ?? [])
    if (tracked(name)) names.add(name);

  const rows: BundledDep[] = [];
  for (const name of [...names].sort()) {
    const base = {
      repo: input.repo,
      package: input.package,
      source: input.source,
      ...(input.sourceVersion ? { sourceVersion: input.sourceVersion } : {}),
      dependency: name,
      latest: input.latest(name),
      workspace: input.workspace(name),
    };
    const own = copies.filter((copy) => copy.name === name);
    const bundledRow = (
      path: string | null,
      version: string | null,
      bundled: "yes" | "assumed",
      files: Set<string> | undefined,
      note?: string,
    ): BundledDep => ({
      ...base,
      path,
      version,
      bundled,
      ...versionStatus(version, base.latest),
      ...(files && files.size ? { files: [...files].sort() } : {}),
      ...(note ? { note } : {}),
    });

    if (input.modules) {
      const byPath = input.modules.get(name);
      if (!byPath) {
        for (const copy of own) {
          rows.push({
            ...base,
            path: copy.path,
            version: copy.version,
            bundled: "no",
            status: "types-only",
            note: copy.dev
              ? "devDependency, not in the bundle"
              : "in the lockfile but not in the bundle (types or tree-shaken)",
          });
        }
        continue;
      }
      const allFiles = new Set([...byPath.values()].flatMap((set) => [...set]));
      const paths = [...byPath.keys()];
      const byNameOnly =
        input.modulesByNameOnly || paths.every((path) => path === "");
      if (byNameOnly) {
        const runtime = own.filter((copy) => !copy.dev);
        const candidates = runtime.length ? runtime : own;
        if (candidates.length === 0) {
          rows.push(
            bundledRow(
              null,
              null,
              "yes",
              allFiles,
              input.lock
                ? "bundled, but not in the lockfile"
                : "no lockfile for this build",
            ),
          );
        }
        for (const copy of candidates)
          rows.push(bundledRow(copy.path, copy.version, "yes", allFiles));
        for (const copy of own.filter((c) => !candidates.includes(c))) {
          rows.push({
            ...base,
            path: copy.path,
            version: copy.version,
            bundled: "no",
            status: "not-bundled",
            note: "devDependency copy",
          });
        }
        continue;
      }
      for (const [path, files] of byPath) {
        const copy = own.find((c) => c.path === path);
        rows.push(
          bundledRow(
            path || null,
            copy?.version ?? null,
            "yes",
            files,
            copy
              ? undefined
              : input.lock
                ? "bundled from a path missing in the lockfile"
                : "no lockfile for this build",
          ),
        );
      }
      for (const copy of own.filter((c) => !byPath.has(c.path))) {
        rows.push({
          ...base,
          path: copy.path,
          version: copy.version,
          bundled: "no",
          status: "not-bundled",
          note: "another copy is bundled",
        });
      }
      continue;
    }

    // No source map: config heuristic.
    for (const copy of own) {
      const external =
        (input.mode.kind === "none" &&
          !matchesExcept(name, input.mode.include)) ||
        (input.mode.kind === "all" && matchesExcept(name, input.mode.except));
      if (copy.dev) {
        rows.push({
          ...base,
          path: copy.path,
          version: copy.version,
          bundled: "no",
          status: "types-only",
          note: "devDependency (assumed types only)",
        });
      } else if (external) {
        rows.push({
          ...base,
          path: copy.path,
          version: copy.version,
          bundled: "no",
          status: "external",
          note: "external per build config: installed by the consumer",
        });
      } else {
        rows.push(
          bundledRow(
            copy.path,
            copy.version,
            "assumed",
            undefined,
            input.mode.kind === "unknown"
              ? "no build config found; assumed bundled"
              : undefined,
          ),
        );
      }
    }
  }
  return rows;
}

// --------------------------------------------------------------------------
// affected check: did the bundled files change between two versions?
// --------------------------------------------------------------------------

/** File (relative to package root) → content, from a package tarball. */
export interface PackageFiles {
  files: Map<string, Buffer>;
}

/**
 * Content of `file` in a package tarball: the file itself, or the
 * `sourcesContent` of a source map that lists it (packages ship dist + maps,
 * not src).
 */
export function sourceIndex(files: Map<string, Buffer>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [path, content] of files) {
    if (!path.endsWith(".map")) continue;
    let map: { sources?: string[]; sourcesContent?: (string | null)[] };
    try {
      map = JSON.parse(content.toString("utf-8"));
    } catch {
      continue;
    }
    const dir = posix.dirname(path);
    (map.sources ?? []).forEach((source, i) => {
      const text = map.sourcesContent?.[i];
      if (typeof text !== "string") return;
      const resolved = posix.normalize(posix.join(dir, source));
      if (!index.has(resolved)) index.set(resolved, text);
    });
  }
  for (const [path, content] of files) {
    if (/\.(?:[cm]?[jt]sx?|json)$/.test(path) && !index.has(path))
      index.set(path, content.toString("utf-8"));
  }
  return index;
}

export function compareFiles(
  files: string[],
  before: Map<string, string>,
  after: Map<string, string>,
): { changed: string[]; unknown: string[] } {
  const changed: string[] = [];
  const unknown: string[] = [];
  for (const file of files) {
    const a = before.get(file);
    const b = after.get(file);
    if (a === undefined || b === undefined) unknown.push(file);
    else if (a !== b) changed.push(file);
  }
  return { changed, unknown };
}

const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|const|let|var|class|enum|interface|type|namespace|module)\s+([A-Za-z_$"'][\w$"'./@-]*)|^declare\s+global\b/;
/** Pseudo-declaration for top-level code that belongs to no declaration. */
export const TOP_LEVEL = "<top-level>";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * Runtime top-level declarations of a JS/TS module, name → source text
 * (comments stripped; types, interfaces, `declare`, imports and re-exports
 * skipped). Regex-based: good enough to compare two versions of a file.
 */
export function topLevelDeclarations(source: string): Map<string, string> {
  const chunks = new Map<string, string[]>();
  let current: string[] | null = null;
  const topLevel: string[] = [];
  for (const line of stripComments(source).split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      const match = line.match(DECLARATION);
      if (match) {
        const isType =
          !match[2] ||
          Boolean(match[1]) ||
          ["interface", "type", "module"].includes(match[2]);
        if (isType) {
          current = null;
          continue;
        }
        current = [];
        chunks.set(match[3], current);
      } else if (/^(?:import|export\s+(?:type\s+)?[{*])/.test(line)) {
        current = null;
        continue;
      } else if (/^[A-Za-z_$@]/.test(line)) {
        current = null;
        topLevel.push(line.trim());
        continue;
      }
    }
    if (current) current.push(line.trimEnd());
    // lines indented inside a skipped type/import belong to nothing
  }
  const result = new Map(
    [...chunks].map(([name, lines]) => [name, lines.join("\n")]),
  );
  if (topLevel.length) result.set(TOP_LEVEL, topLevel.join("\n"));
  return result;
}

/** Declarations whose text differs (or that disappeared) between versions. */
export function changedDeclarations(before: string, after: string): string[] {
  const a = topLevelDeclarations(before);
  const b = topLevelDeclarations(after);
  return [...a.keys()].filter((name) => a.get(name) !== b.get(name)).sort();
}

/** Is a declaration of `name` in the bundle? esbuild keeps names, adding digits on collisions. */
export function declaredInBundle(bundle: string, name: string): boolean {
  if (name === TOP_LEVEL) return true;
  const escaped = name.replace(/\$/g, "\\$");
  return new RegExp(
    `(?:function\\*?|var|let|const|class)\\s+${escaped}\\d*\\b`,
  ).test(bundle);
}

/**
 * Downgrade a stale row to stale-unaffected when the bundled code didn't
 * change: every bundled file is identical in latest, or (given the bundle's
 * JS) every declaration that changed in those files is absent from the
 * bundle, i.e. was tree-shaken away. Unknown files keep it stale.
 */
export function applyAffected(
  row: BundledDep,
  before: Map<string, string> | null,
  after: Map<string, string> | null,
  bundle?: string,
): BundledDep {
  if (row.status !== "stale" || !row.files?.length || !before || !after)
    return row;
  const { changed, unknown } = compareFiles(row.files, before, after);
  const changedSymbols: string[] = [];
  const affectedFiles = changed.filter((file) => {
    if (bundle === undefined) return true;
    const used = changedDeclarations(
      before.get(file)!,
      after.get(file)!,
    ).filter((name) => declaredInBundle(bundle, name));
    changedSymbols.push(...used.map((name) => `${file}#${name}`));
    return used.length > 0;
  });
  const note = unknown.length
    ? { note: `${unknown.length} bundled file(s) not comparable` }
    : {};
  if (affectedFiles.length === 0 && unknown.length === 0)
    return {
      ...row,
      status: "stale-unaffected",
      changedFiles: changed,
      ...(bundle !== undefined ? { changedSymbols: [] } : {}),
    };
  return {
    ...row,
    changedFiles: changed,
    ...(bundle !== undefined ? { changedSymbols } : {}),
    ...note,
  };
}

// --------------------------------------------------------------------------
// changelog
// --------------------------------------------------------------------------

/** Changesets CHANGELOG entries in (from, to]. First line of each bullet. */
export function changelogBetween(
  markdown: string,
  from: string,
  to: string,
  maxLines = 3,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/);
    if (heading) {
      const version = heading[1];
      current =
        semver.valid(version) &&
        semver.gt(version, from) &&
        semver.lte(version, to)
          ? { version, lines: [] }
          : null;
      if (current) entries.push(current);
      continue;
    }
    if (!current || current.lines.length >= maxLines) continue;
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (!bullet) continue;
    const text = bullet[1]
      .replace(/^(?:\[[0-9a-f]{7,40}\]\([^)]*\)|[0-9a-f]{7,40}):\s*/, "")
      .replace(/^Updated dependencies.*$/, "Updated dependencies")
      .trim();
    if (text) current.lines.push(text);
  }
  return entries.sort((a, b) => semver.rcompare(a.version, b.version));
}

// --------------------------------------------------------------------------
// tarballs (in memory; nothing extracted to disk)
// --------------------------------------------------------------------------

function cString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf-8");
}

/** Minimal ustar/pax reader for npm tarballs: regular files only, `package/` stripped. */
export function readTarball(gz: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(gz);
  const files = new Map<string, Buffer>();
  let offset = 0;
  let paxPath: string | undefined;
  let longName: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = cString(header, 0, 100);
    const size = Number.parseInt(cString(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const ustar = cString(header, 257, 6).startsWith("ustar");
    const prefix = ustar ? cString(header, 345, 155) : "";
    const start = offset + 512;
    const data = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === "x") {
      const match = data.toString("utf-8").match(/\d+ path=([^\n]*)\n/);
      paxPath = match?.[1];
      continue;
    }
    if (type === "L") {
      longName = cString(data, 0, data.length);
      continue;
    }
    if (type === "0" || type === "7") {
      const full = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
      const path = full.replace(/^[^/]+\//, "");
      if (path && !path.split("/").includes(".."))
        files.set(path, Buffer.from(data));
    }
    paxPath = undefined;
    longName = undefined;
  }
  return files;
}

// --------------------------------------------------------------------------
// summary
// --------------------------------------------------------------------------

export type FailOn = "stale" | "any";

export function isFailing(row: BundledDep, failOn: FailOn): boolean {
  if (row.status === "stale") return true;
  return failOn === "any" && row.status === "stale-unaffected";
}

export function summarize(rows: BundledDep[]): Record<BundledStatus, number> {
  const counts = {
    current: 0,
    stale: 0,
    "stale-unaffected": 0,
    ahead: 0,
    "types-only": 0,
    "not-bundled": 0,
    external: 0,
    unknown: 0,
  } satisfies Record<BundledStatus, number>;
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/**
 * Lockfile copies of `name` older than `version` that end up in a bundle
 * (non-dev, and not external per build config). Used by `release plan`.
 */
export function bundledCopiesBelow(
  lock: BundleLock,
  mode: BundleMode,
  name: string,
  version: string,
): LockCopy[] {
  if (!semver.valid(version)) return [];
  return trackedLockCopies(lock, (n) => n === name).filter(
    (copy) =>
      !copy.dev &&
      semver.lt(copy.version, version) &&
      !(mode.kind === "none" && !matchesExcept(name, mode.include)) &&
      !(mode.kind === "all" && matchesExcept(name, mode.except)),
  );
}
