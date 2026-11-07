/**
 * Isolated Quartz build sandboxes.
 *
 * Quartz resolves `quartz.config.yaml`, `.quartz/plugins` and `public/` relative
 * to `process.cwd()`. Building directly in `repos/quartz` therefore clobbers any
 * running `just serve` and makes parallel builds impossible.
 *
 * A sandbox is a lightweight copy of the Quartz *source tree* (≈17 MB, no
 * node_modules) under `.dev/sandboxes/<name>/` with `node_modules` symlinked back
 * to `repos/quartz/node_modules`. Plugin packages therefore still resolve to the
 * workspace-linked `repos/<plugin>/dist`, so local plugin changes are picked up
 * after `just build-plugin <name>`.
 *
 * Nothing under `repos/` is modified.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";

export const WORKSPACE_ROOT = resolve(import.meta.dirname, "../..");
export const REPOS_DIR = join(WORKSPACE_ROOT, "repos");
export const QUARTZ_DIR = join(REPOS_DIR, "quartz");
export const DEV_DIR = join(WORKSPACE_ROOT, ".dev");
export const SANDBOX_ROOT = join(DEV_DIR, "sandboxes");
export const SITES_ROOT = join(DEV_DIR, "sites");
const TSX_CLI = join(WORKSPACE_ROOT, "node_modules/tsx/dist/cli.mjs");

export const BUILD_TIMEOUT_MS = Number(
  process.env.QUARTZ_BUILD_TIMEOUT ?? 180_000,
);

/** Top-level entries of repos/quartz that are never copied into a sandbox. */
const SANDBOX_EXCLUDE = new Set([
  "node_modules",
  ".git",
  "public",
  "docs",
  "content",
  ".quartz",
  ".turbo",
  "quartz.config.yaml",
  "prof",
  "tsconfig.tsbuildinfo",
]);

// ---------------------------------------------------------------------------
// Config handling
// ---------------------------------------------------------------------------

export type PluginSourceValue =
  | string
  | { name?: string; repo?: string; subdir?: string; [key: string]: unknown };

export interface QuartzPluginEntry {
  source: PluginSourceValue;
  enabled?: boolean;
  options?: Record<string, unknown>;
  order?: number;
  layout?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QuartzConfig {
  configuration: Record<string, unknown>;
  plugins: QuartzPluginEntry[];
  layout?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Overlay applied on top of a base config. Mirrors the shape of
 * quartz.config.yaml so it can be written as a small YAML file next to a repro.
 *
 *   configuration: { enableSPA: false }
 *   enable: [graph]
 *   disable: [explorer]
 *   plugins:
 *     graph: { options: { localGraph: { depth: 2 } }, layout: { position: left } }
 */
export interface ConfigOverlay {
  extends?: string;
  configuration?: Record<string, unknown>;
  enable?: string[];
  disable?: string[];
  only?: string[];
  plugins?: Record<string, Partial<QuartzPluginEntry>>;
  layout?: Record<string, unknown>;
}

/** Short plugin name for a source spec: "@quartz-community/graph" -> "graph". */
export function pluginNameFromSource(source: PluginSourceValue): string {
  if (typeof source === "string") {
    const s = source.replace(/#.*$/, "").replace(/\/+$/, "");
    const last = s.split(/[/:]/).pop() ?? s;
    return last.replace(/\.git$/, "");
  }
  if (source.name) return String(source.name);
  if (source.subdir) return String(source.subdir).split("/").pop() ?? "";
  if (source.repo) return pluginNameFromSource(String(source.repo));
  return "";
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge where arrays and scalars in `patch` replace those in `base`. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

export function readYaml<T>(path: string): T {
  try {
    return parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    throw new Error(
      `Cannot read YAML ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function findPluginEntry(
  config: QuartzConfig,
  name: string,
): QuartzPluginEntry | undefined {
  return config.plugins.find(
    (entry) => pluginNameFromSource(entry.source) === name,
  );
}

/** Apply an overlay to a config, returning a new config object. */
export function applyOverlay(
  config: QuartzConfig,
  overlay: ConfigOverlay,
): QuartzConfig {
  const next: QuartzConfig = structuredClone(config);
  if (overlay.configuration) {
    next.configuration = deepMerge(next.configuration, overlay.configuration);
  }
  if (overlay.layout) {
    next.layout = deepMerge(next.layout ?? {}, overlay.layout);
  }
  const known = new Set(
    next.plugins.map((entry) => pluginNameFromSource(entry.source)),
  );
  const requireKnown = (name: string, context: string) => {
    if (!known.has(name)) {
      throw new Error(
        `${context}: plugin "${name}" is not in the base config. Known: ${[...known].join(", ")}`,
      );
    }
  };
  if (overlay.only) {
    const only = new Set(overlay.only);
    for (const name of only) requireKnown(name, "only");
    for (const entry of next.plugins) {
      entry.enabled = only.has(pluginNameFromSource(entry.source));
    }
  }
  for (const name of overlay.enable ?? []) {
    requireKnown(name, "enable");
    findPluginEntry(next, name)!.enabled = true;
  }
  for (const name of overlay.disable ?? []) {
    requireKnown(name, "disable");
    findPluginEntry(next, name)!.enabled = false;
  }
  for (const [name, patch] of Object.entries(overlay.plugins ?? {})) {
    const entry = findPluginEntry(next, name);
    if (!entry) {
      if (!patch.source) {
        throw new Error(
          `plugins.${name}: not in base config; add a "source" to append it as a new plugin`,
        );
      }
      next.plugins.push({ enabled: true, ...patch } as QuartzPluginEntry);
      continue;
    }
    Object.assign(entry, deepMerge(entry, patch));
  }
  return next;
}

/**
 * Resolve the base config for a build.
 *   "default"       -> repos/quartz/quartz.config.default.yaml
 *   "fixture:<name>" -> e2e/fixtures/<name>/quartz.config.yaml
 *   anything else   -> treated as a path
 */
export function resolveBaseConfigPath(
  spec: string | undefined,
  relativeTo = WORKSPACE_ROOT,
): string {
  if (!spec || spec === "default")
    return join(QUARTZ_DIR, "quartz.config.default.yaml");
  if (spec.startsWith("fixture:")) {
    return join(
      WORKSPACE_ROOT,
      "e2e/fixtures",
      spec.slice("fixture:".length),
      "quartz.config.yaml",
    );
  }
  return isAbsolute(spec) ? spec : resolve(relativeTo, spec);
}

/**
 * Load a config file. If the file is an overlay (has `extends`, `enable`,
 * `disable`, `only` or a `plugins` *map*), resolve its base and apply it.
 */
export function loadConfig(path: string, depth = 0): QuartzConfig {
  if (depth > 5) throw new Error(`Config extends chain too deep at ${path}`);
  const raw = readYaml<Record<string, unknown>>(path) ?? {};
  const isOverlay =
    "extends" in raw ||
    "enable" in raw ||
    "disable" in raw ||
    "only" in raw ||
    (raw.plugins !== undefined && isPlainObject(raw.plugins));
  if (!isOverlay) {
    const config = raw as QuartzConfig;
    if (!Array.isArray(config.plugins)) {
      throw new Error(
        `${path}: expected a "plugins" array (full config) or an overlay`,
      );
    }
    return config;
  }
  const overlay = raw as ConfigOverlay;
  const basePath = resolveBaseConfigPath(overlay.extends, dirname(path));
  return applyOverlay(loadConfig(basePath, depth + 1), overlay);
}

export function enabledPluginNames(config: QuartzConfig): string[] {
  return config.plugins
    .filter((entry) => entry.enabled !== false)
    .map((entry) => pluginNameFromSource(entry.source));
}

// ---------------------------------------------------------------------------
// Workspace package lookup and stale-dist detection
// ---------------------------------------------------------------------------

/** Map of npm package name -> repo directory (scans repos/*). */
export function workspacePackages(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(REPOS_DIR)) return map;
  for (const dir of readdirSync(REPOS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgPath = join(REPOS_DIR, dir.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        name?: string;
      };
      if (pkg.name) map.set(pkg.name, join(REPOS_DIR, dir.name));
    } catch {
      // ignore unreadable package.json
    }
  }
  return map;
}

/** Resolve the repo dir backing a plugin entry, if it is a workspace package. */
export function repoDirForSource(
  source: PluginSourceValue,
  packages = workspacePackages(),
): string | undefined {
  if (typeof source === "string") {
    if (source.startsWith("@")) return packages.get(source);
    if (source.startsWith("github:quartz-community/")) {
      return packages.get(
        `@quartz-community/${source.slice("github:quartz-community/".length)}`,
      );
    }
    if (source.startsWith("./") || source.startsWith("../")) {
      const dir = resolve(QUARTZ_DIR, source);
      return existsSync(dir) ? dir : undefined;
    }
  }
  const name = pluginNameFromSource(source);
  return (
    packages.get(`@quartz-community/${name}`) ??
    (existsSync(join(REPOS_DIR, name)) ? join(REPOS_DIR, name) : undefined)
  );
}

function newestMtime(
  path: string,
  skip = new Set(["node_modules", ".git", "dist", ".turbo"]),
): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    newest = Math.max(newest, newestMtime(join(path, entry.name), skip));
  }
  return newest;
}

function oldestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let oldest = Number.POSITIVE_INFINITY;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const m = oldestMtime(join(path, entry.name));
    if (m > 0) oldest = Math.min(oldest, m);
  }
  return oldest === Number.POSITIVE_INFINITY ? 0 : oldest;
}

/** "missing" / "stale" if repoDir has src/ and its dist/ is missing or older; else null. */
export function distState(repoDir: string): "missing" | "stale" | null {
  const srcDir = join(repoDir, "src");
  if (!existsSync(srcDir)) return null;
  const dist = join(repoDir, "dist");
  if (!existsSync(dist)) return "missing";
  return newestMtime(srcDir) > oldestMtime(dist) + 1000 ? "stale" : null;
}

export interface StaleDist {
  name: string;
  repo: string;
  reason: "missing" | "stale";
}

/**
 * Detect enabled workspace plugins whose dist/ is missing or older than src/.
 * Quartz consumes plugins from dist/, so a stale dist silently tests old code —
 * one of the most common "my fix doesn't work" traps.
 */
export function findStaleDists(config: QuartzConfig): StaleDist[] {
  const packages = workspacePackages();
  const stale: StaleDist[] = [];
  for (const entry of config.plugins) {
    if (entry.enabled === false) continue;
    const repo = repoDirForSource(entry.source, packages);
    if (!repo) continue;
    // Infra packages are checked as dependencies below.
    const srcDir = join(repo, "src");
    if (!existsSync(srcDir)) continue;
    const dist = join(repo, "dist");
    const name = pluginNameFromSource(entry.source);
    if (!existsSync(dist)) {
      stale.push({ name, repo, reason: "missing" });
      continue;
    }
    if (newestMtime(srcDir) > oldestMtime(dist) + 1000) {
      stale.push({ name, repo, reason: "stale" });
    }
  }
  for (const infra of [
    "types",
    "utils",
    "runtime",
    "remark-obsidian",
    "rehype-obsidian",
  ]) {
    const repo = join(REPOS_DIR, infra);
    const srcDir = join(repo, "src");
    if (!existsSync(srcDir)) continue;
    const dist = join(repo, "dist");
    if (!existsSync(dist)) stale.push({ name: infra, repo, reason: "missing" });
    else if (newestMtime(srcDir) > oldestMtime(dist) + 1000) {
      stale.push({ name: infra, repo, reason: "stale" });
    }
  }
  return stale;
}

// ---------------------------------------------------------------------------
// Sandbox lifecycle
// ---------------------------------------------------------------------------

export function validateSandboxName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name)) {
    throw new Error(
      `Invalid sandbox name "${name}" (use letters, digits, . _ -)`,
    );
  }
}

/** Create or refresh the sandbox directory for `name` and return its path. */
export function prepareSandbox(name: string): string {
  validateSandboxName(name);
  if (!existsSync(join(QUARTZ_DIR, "package.json"))) {
    throw new Error(
      `Quartz not found at ${QUARTZ_DIR}. Run 'just setup' first.`,
    );
  }
  const dir = join(SANDBOX_ROOT, name);
  mkdirSync(dir, { recursive: true });

  // Preserve the transpile cache across refreshes (saves ~2-3s per build).
  const cache = join(dir, "quartz/.quartz-cache");
  const cacheStash = join(dir, ".quartz-cache-stash");
  if (existsSync(cache)) {
    rmSync(cacheStash, { recursive: true, force: true });
    renameSync(cache, cacheStash);
  }

  for (const entry of readdirSync(dir)) {
    if (
      ["node_modules", ".git", ".quartz-cache-stash", ".lock"].includes(entry)
    )
      continue;
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
  for (const entry of readdirSync(QUARTZ_DIR)) {
    if (SANDBOX_EXCLUDE.has(entry)) continue;
    cpSync(join(QUARTZ_DIR, entry), join(dir, entry), {
      recursive: true,
      filter: (src) => !src.includes(`${"/"}.quartz-cache`),
    });
  }
  if (existsSync(cacheStash)) {
    renameSync(cacheStash, cache);
  }
  if (!existsSync(join(dir, "node_modules"))) {
    symlinkSync(
      join(QUARTZ_DIR, "node_modules"),
      join(dir, "node_modules"),
      "dir",
    );
  }
  // Quartz globs with `gitignore: true`. Without its own git root the sandbox
  // would inherit dev-mode's .gitignore (which ignores .dev/) and silently drop
  // every file in quartz/static. Make the sandbox a git root of its own.
  if (!existsSync(join(dir, ".git"))) {
    execFileSync("git", ["init", "-q"], {
      cwd: dir,
      timeout: 10_000,
      stdio: "ignore",
    });
  }
  return dir;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  onOutput?: (chunk: string) => void,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        // CI=1 only turns off Quartz's spinner. Quartz also fails builds in CI when a plugin's
        // quartzVersion excludes this Quartz; locally that stays a warning (plugins in the
        // workspace may already require an unreleased core version), in real CI it fails.
        CI: process.env.CI ?? "1",
        ...(process.env.CI ? {} : { QUARTZ_ALLOW_INCOMPATIBLE_PLUGINS: "1" }),
      },
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      const text = String(chunk);
      output += text;
      onOutput?.(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, output, timedOut });
    });
  });
}

export async function withLock<T>(
  dir: string,
  fn: () => Promise<T>,
  timeoutMs = BUILD_TIMEOUT_MS,
): Promise<T> {
  const lock = join(dir, ".lock");
  mkdirSync(dir, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // Stale lock (process died) — older than the timeout.
      try {
        if (Date.now() - statSync(lock).mtimeMs > timeoutMs) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > timeoutMs)
        throw new Error(`Timed out waiting for lock ${lock}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Prepare a sandbox with a config and run install-plugins, ready for any
 * Quartz CLI command (used by `site dev` for a sandboxed live server).
 */
export async function prepareConfiguredSandbox(
  name: string,
  config: QuartzConfig,
  timeoutMs = BUILD_TIMEOUT_MS,
): Promise<{ dir: string; ok: boolean; log: string }> {
  const dir = prepareSandbox(name);
  writeFileSync(
    join(dir, "quartz.config.yaml"),
    stringify(config, { lineWidth: 0 }),
  );
  const install = await runProcess(
    process.execPath,
    [TSX_CLI, "./quartz/plugins/loader/install-plugins.ts"],
    dir,
    timeoutMs,
  );
  return {
    dir,
    ok: install.code === 0 && !install.timedOut,
    log: stripAnsi(install.output),
  };
}

export interface BuildSiteOptions {
  /** Sandbox name (reused between builds to keep the transpile cache warm). */
  name: string;
  /** Fully-resolved config to build with. */
  config: QuartzConfig;
  /** Content directory (absolute or relative to the workspace root). */
  contentDir: string;
  /** Output directory. Defaults to .dev/sites/<name>. */
  outDir?: string;
  /** Stream Quartz output to stdout. */
  verbose?: boolean;
  timeoutMs?: number;
}

export interface BuildSiteResult {
  ok: boolean;
  name: string;
  sandboxDir: string;
  outDir: string;
  contentDir: string;
  durationMs: number;
  enabledPlugins: string[];
  staleDists: StaleDist[];
  warnings: string[];
  errors: string[];
  log: string;
  logPath: string;
}

/** Strip ANSI escape codes. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/** Pull warning / error lines out of Quartz build output. */
export function extractDiagnostics(log: string): {
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const rawLine of stripAnsi(log).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Plugin-index export conflicts are expected noise in a full workspace.
    if (/conflicts across plugins/.test(line)) continue;
    if (line.startsWith("⚠") || /^warn(ing)?\b/i.test(line))
      warnings.push(line);
    else if (
      line.startsWith("✗") ||
      /^(error|Error:|TypeError|ReferenceError|SyntaxError)\b/.test(line) ||
      /Failed to (load|instantiate|build)/i.test(line)
    ) {
      errors.push(line);
    }
  }
  return { warnings, errors };
}

/**
 * Build a Quartz site in an isolated sandbox. Never touches repos/quartz.
 */
export async function buildSite(
  options: BuildSiteOptions,
): Promise<BuildSiteResult> {
  const start = Date.now();
  const contentDir = isAbsolute(options.contentDir)
    ? options.contentDir
    : resolve(WORKSPACE_ROOT, options.contentDir);
  if (!existsSync(contentDir))
    throw new Error(`Content directory not found: ${contentDir}`);
  const outDir = options.outDir
    ? resolve(WORKSPACE_ROOT, options.outDir)
    : join(SITES_ROOT, options.name);
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;

  return withLock(
    join(SANDBOX_ROOT, `${options.name}.lock.d`),
    async () => {
      const sandboxDir = prepareSandbox(options.name);
      writeFileSync(
        join(sandboxDir, "quartz.config.yaml"),
        stringify(options.config, { lineWidth: 0 }),
      );
      const staleDists = findStaleDists(options.config);
      const echo = options.verbose
        ? (chunk: string) => process.stdout.write(chunk)
        : undefined;

      let log = "";
      const install = await runProcess(
        process.execPath,
        [TSX_CLI, "./quartz/plugins/loader/install-plugins.ts"],
        sandboxDir,
        timeoutMs,
        echo,
      );
      log += install.output;
      let ok = install.code === 0 && !install.timedOut;

      const tmpOut = join(sandboxDir, "public");
      if (ok) {
        const build = await runProcess(
          process.execPath,
          [
            "quartz/bootstrap-cli.mjs",
            "build",
            "-d",
            contentDir,
            "-o",
            "public",
            // Quartz's own --verbose: plugin order, built-ins, layout report, per-file output
            ...(options.verbose ? ["--verbose"] : []),
          ],
          sandboxDir,
          timeoutMs,
          echo,
        );
        log += build.output;
        if (build.timedOut) log += `\n✗ Build timed out after ${timeoutMs}ms\n`;
        ok = build.code === 0 && !build.timedOut && existsSync(tmpOut);
      } else if (install.timedOut) {
        log += `\n✗ install-plugins timed out after ${timeoutMs}ms\n`;
      }

      if (ok) {
        rmSync(outDir, { recursive: true, force: true });
        mkdirSync(dirname(outDir), { recursive: true });
        try {
          renameSync(tmpOut, outDir);
        } catch {
          cpSync(tmpOut, outDir, { recursive: true });
          rmSync(tmpOut, { recursive: true, force: true });
        }
      }

      const logPath = join(DEV_DIR, "logs", `build-${options.name}.log`);
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, stripAnsi(log));
      const { warnings, errors } = extractDiagnostics(log);
      return {
        ok,
        name: options.name,
        sandboxDir,
        outDir,
        contentDir,
        durationMs: Date.now() - start,
        enabledPlugins: enabledPluginNames(options.config),
        staleDists,
        warnings,
        errors,
        log: stripAnsi(log),
        logPath,
      };
    },
    timeoutMs * 2,
  );
}

/** Human-readable path relative to the workspace root. */
export function rel(path: string): string {
  const r = relative(WORKSPACE_ROOT, path);
  return r.startsWith("..") ? path : r;
}
