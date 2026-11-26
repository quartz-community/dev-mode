/**
 * I/O for bundled-deps: repo files (local git refs, else raw GitHub), npm
 * packuments and tarballs (cached in .dev/cache/npm-tarballs; read in
 * memory, never extracted), local dist source maps. Every network request
 * and subprocess has a timeout.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { runCommandCapture, TIMEOUTS } from "../exec.js";
import { isRetryableRegistryStatus, registryUrl } from "../registry.js";
import { readTarball, type SourceMapFile } from "./analyze.js";

const REQUEST_TIMEOUT_MS = 20_000;
const TARBALL_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_TARBALL_BYTES = 100 * 1024 * 1024;
const USER_AGENT = "@quartz-community/dev-mode bundled-deps";

export interface RepoTarget {
  /** dev.yaml name (= repos/<name> directory). */
  name: string;
  /** owner/repo on GitHub. */
  slug: string;
  branch?: string;
  /** repos/<name> if it is a git clone. */
  localPath?: string;
}

class HttpError extends Error {}

async function fetchWithRetry(
  url: string,
  timeout: number,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status === 404) return null;
      if (response.ok) return response;
      const error = new HttpError(`${url}: HTTP ${response.status}`);
      if (!isRetryableRegistryStatus(response.status) && response.status < 500)
        throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof HttpError) throw error; // not retryable
      lastError = error; // network error / timeout: retry
    }
    if (attempt < MAX_ATTEMPTS)
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// --------------------------------------------------------------------------
// repo files
// --------------------------------------------------------------------------

export interface RepoFileOptions {
  /** Skip local clones, always read from GitHub (CI, or local refs unreliable). */
  remote?: boolean;
  /** Never fall back to GitHub (offline callers). */
  localOnly?: boolean;
}

/**
 * Refresh the clone's remote-tracking ref of the default branch (no working
 * tree change). Returns an error message instead of throwing.
 */
export async function fetchDefaultBranch(
  target: RepoTarget,
): Promise<string | null> {
  if (!target.localPath) return null;
  const args = target.branch
    ? [
        "fetch",
        "-q",
        "origin",
        `+refs/heads/${target.branch}:refs/remotes/origin/${target.branch}`,
      ]
    : ["fetch", "-q", "origin"];
  try {
    await runCommandCapture("git", args, target.localPath, false, {
      timeout: TIMEOUTS.GIT_CLONE,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function localRef(target: RepoTarget): string {
  return target.branch ? `origin/${target.branch}` : "origin/HEAD";
}

/**
 * A file on the default branch (or at `ref`, e.g. a release's gitHead).
 * Local clone first (`git show`, no network); shallow clones miss old
 * commits, so those fall back to raw.githubusercontent.com.
 */
export async function readRepoFile(
  target: RepoTarget,
  path: string,
  ref?: string,
  options: RepoFileOptions = {},
): Promise<string | null> {
  if (target.localPath && !options.remote) {
    try {
      return await runCommandCapture(
        "git",
        ["show", `${ref ?? localRef(target)}:${path}`],
        target.localPath,
        false,
        { timeout: TIMEOUTS.GIT_OP },
      );
    } catch {
      // missing file, or a commit a shallow clone doesn't have
      if (!ref) {
        // the ref exists locally but the file doesn't: trust that
        try {
          await runCommandCapture(
            "git",
            ["rev-parse", "--verify", "-q", localRef(target)],
            target.localPath,
            false,
            { timeout: TIMEOUTS.GIT_OP },
          );
          return null;
        } catch {
          // no such ref: ask GitHub
        }
      }
    }
  }
  if (options.localOnly || !target.slug) return null;
  const url = `https://raw.githubusercontent.com/${target.slug}/${ref ?? target.branch ?? "HEAD"}/${path}`;
  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  const response = await fetchWithRetry(url, REQUEST_TIMEOUT_MS, headers);
  return response ? response.text() : null;
}

// --------------------------------------------------------------------------
// npm
// --------------------------------------------------------------------------

export interface PackumentInfo {
  latest: string | null;
  versions: Record<string, { gitHead?: string; tarball?: string }>;
}

export class Registry {
  private packuments = new Map<string, Promise<PackumentInfo | null>>();
  private tarballs = new Map<string, Promise<Map<string, Buffer> | null>>();

  constructor(private cacheDir: string) {}

  /** Full packument (abbreviated ones lack gitHead). null = not on npm. */
  packument(name: string): Promise<PackumentInfo | null> {
    let pending = this.packuments.get(name);
    if (!pending) {
      pending = (async () => {
        const response = await fetchWithRetry(
          registryUrl(name),
          REQUEST_TIMEOUT_MS,
        );
        if (!response) return null;
        const body = (await response.json()) as {
          "dist-tags"?: Record<string, string>;
          versions?: Record<
            string,
            { gitHead?: string; dist?: { tarball?: string } }
          >;
        };
        const versions: PackumentInfo["versions"] = {};
        for (const [version, meta] of Object.entries(body.versions ?? {}))
          versions[version] = {
            gitHead: meta.gitHead,
            tarball: meta.dist?.tarball,
          };
        return { latest: body["dist-tags"]?.latest ?? null, versions };
      })();
      this.packuments.set(name, pending);
    }
    return pending;
  }

  /** Files of a published version (path relative to the package root). */
  tarball(name: string, version: string): Promise<Map<string, Buffer> | null> {
    const key = `${name}@${version}`;
    let pending = this.tarballs.get(key);
    if (!pending) {
      pending = (async () => {
        const file = join(
          this.cacheDir,
          `${name.replace(/^@/, "").replace(/\//g, "__")}-${version}.tgz`,
        );
        if (existsSync(file)) return readTarball(readFileSync(file));
        const info = await this.packument(name);
        const url = info?.versions[version]?.tarball;
        if (!url) return null;
        const response = await fetchWithRetry(url, TARBALL_TIMEOUT_MS);
        if (!response) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_TARBALL_BYTES)
          throw new Error(
            `${key}: tarball larger than ${MAX_TARBALL_BYTES} bytes`,
          );
        mkdirSync(this.cacheDir, { recursive: true });
        writeFileSync(`${file}.tmp`, buffer);
        renameSync(`${file}.tmp`, file);
        return readTarball(buffer);
      })();
      this.tarballs.set(key, pending);
    }
    return pending;
  }
}

// --------------------------------------------------------------------------
// source maps
// --------------------------------------------------------------------------

function parseSources(text: string): string[] {
  try {
    const map = JSON.parse(text) as { sources?: unknown };
    return Array.isArray(map.sources)
      ? map.sources.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

export function tarballSourceMaps(files: Map<string, Buffer>): SourceMapFile[] {
  return [...files]
    .filter(([path]) => path.endsWith(".map"))
    .map(([path, content]) => ({
      path,
      sources: parseSources(content.toString("utf-8")),
    }));
}

const BUNDLE_JS = /\.(?:[cm]?js)$/;

/** All JS of a published build (to look up which declarations survived tree-shaking). */
export function tarballBundleText(files: Map<string, Buffer>): string {
  return [...files]
    .filter(([path]) => BUNDLE_JS.test(path))
    .map(([, content]) => content.toString("utf-8"))
    .join("\n");
}

/** All JS in a local dist/. */
export function localBundleText(repoPath: string): string {
  const dist = join(repoPath, "dist");
  if (!existsSync(dist)) return "";
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (BUNDLE_JS.test(entry.name))
        parts.push(readFileSync(full, "utf-8"));
    }
  };
  walk(dist);
  return parts.join("\n");
}

/** dist/**\/*.map of a local build (the workspace's, built from linked sources). */
export function localSourceMaps(repoPath: string): SourceMapFile[] {
  const dist = join(repoPath, "dist");
  if (!existsSync(dist)) return [];
  const maps: SourceMapFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".map"))
        maps.push({
          path: relative(repoPath, full).split(sep).join("/"),
          sources: parseSources(readFileSync(full, "utf-8")),
        });
    }
  };
  walk(dist);
  return maps;
}
