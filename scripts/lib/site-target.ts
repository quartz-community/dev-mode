/**
 * Shared "site target" resolution for site / repro / inspect / visual tools.
 *
 * Target specs:
 *   fixture:<name>   e2e/fixtures/<name>/{quartz.config.yaml,content/}
 *   repro:<slug>     e2e/repros/<slug>/{quartz.config.yaml?,content/}
 *                    (config optional; may be an overlay with `extends:`)
 *   docs             repos/quartz/docs with quartz.config.default.yaml
 *   <path>           a directory containing quartz.config.yaml + content/,
 *                    or an already-built site directory (has index.html)
 *
 * Bare names are accepted when unambiguous ("bug-repro" -> fixture:bug-repro).
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  buildSite,
  loadConfig,
  QUARTZ_DIR,
  SITES_ROOT,
  WORKSPACE_ROOT,
  type BuildSiteResult,
  type QuartzConfig,
} from "./sandbox.js";
import { basePathFromBaseUrl } from "./static-server.js";

export const FIXTURES_DIR = join(WORKSPACE_ROOT, "e2e/fixtures");
export const REPROS_DIR = join(WORKSPACE_ROOT, "e2e/repros");

export type SiteTargetKind =
  "fixture" | "repro" | "docs" | "source-dir" | "built-dir";

export interface SiteTarget {
  kind: SiteTargetKind;
  /** Normalized spec, e.g. "fixture:bug-repro". */
  spec: string;
  /** Short identifier usable in file names and sandbox names. */
  id: string;
  /** Source dir (fixture/repro dir) — undefined for built-dir. */
  sourceDir?: string;
  configPath?: string;
  contentDir?: string;
  /** For built-dir targets: the site directory. */
  builtDir?: string;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

export function listFixtures(): string[] {
  return listDirs(FIXTURES_DIR).filter((name) =>
    existsSync(join(FIXTURES_DIR, name, "content")),
  );
}

export function listRepros(): string[] {
  return listDirs(REPROS_DIR).filter((name) =>
    existsSync(join(REPROS_DIR, name, "content")),
  );
}

function sourceTarget(
  kind: SiteTargetKind,
  spec: string,
  id: string,
  dir: string,
): SiteTarget {
  const configPath = join(dir, "quartz.config.yaml");
  const contentDir = join(dir, "content");
  if (!existsSync(contentDir)) {
    throw new Error(`${spec}: no content/ directory in ${dir}`);
  }
  return {
    kind,
    spec,
    id,
    sourceDir: dir,
    configPath: existsSync(configPath) ? configPath : undefined,
    contentDir,
  };
}

export function parseSiteTarget(input: string): SiteTarget {
  const spec = input.trim();
  if (!spec) throw new Error("Empty site target");
  if (spec.startsWith("fixture:")) {
    const name = spec.slice("fixture:".length);
    const dir = join(FIXTURES_DIR, name);
    if (!existsSync(dir)) {
      throw new Error(
        `Unknown fixture "${name}". Available: ${listFixtures().join(", ")}`,
      );
    }
    return sourceTarget("fixture", spec, `fixture-${name}`, dir);
  }
  if (spec.startsWith("repro:")) {
    const slug = spec.slice("repro:".length);
    const dir = join(REPROS_DIR, slug);
    if (!existsSync(dir)) {
      throw new Error(
        `Unknown repro "${slug}". Available: ${listRepros().join(", ") || "(none)"} — create one with 'just repro-new ${slug}'`,
      );
    }
    return sourceTarget("repro", spec, `repro-${slug}`, dir);
  }
  if (spec === "docs") {
    return {
      kind: "docs",
      spec,
      id: "docs",
      configPath: join(QUARTZ_DIR, "quartz.config.default.yaml"),
      contentDir: join(QUARTZ_DIR, "docs"),
    };
  }
  const asPath = isAbsolute(spec) ? spec : resolve(process.cwd(), spec);
  if (existsSync(asPath)) {
    if (existsSync(join(asPath, "content"))) {
      return sourceTarget(
        "source-dir",
        spec,
        `dir-${basename(asPath)}`,
        asPath,
      );
    }
    if (existsSync(join(asPath, "index.html"))) {
      return {
        kind: "built-dir",
        spec,
        id: `built-${basename(asPath)}`,
        builtDir: asPath,
      };
    }
    throw new Error(`${spec}: directory has neither content/ nor index.html`);
  }
  // Bare name: fixture or repro.
  const isFixture = existsSync(join(FIXTURES_DIR, spec));
  const isRepro = existsSync(join(REPROS_DIR, spec));
  if (isFixture && isRepro) {
    throw new Error(
      `"${spec}" is both a fixture and a repro; use fixture:${spec} or repro:${spec}`,
    );
  }
  if (isFixture) return parseSiteTarget(`fixture:${spec}`);
  if (isRepro) return parseSiteTarget(`repro:${spec}`);
  throw new Error(
    `Unknown site target "${spec}". Use fixture:<name> (${listFixtures().join(", ")}), repro:<slug> (${listRepros().join(", ") || "none"}), docs, or a path.`,
  );
}

/** Resolve the full Quartz config for a source target. */
export function resolveTargetConfig(
  target: SiteTarget,
  configOverride?: string,
): QuartzConfig {
  if (target.kind === "built-dir") {
    throw new Error(
      `${target.spec} is an already-built site; it has no config`,
    );
  }
  if (configOverride) return loadConfig(resolve(process.cwd(), configOverride));
  if (target.configPath) return loadConfig(target.configPath);
  // Repro without config: default config.
  return loadConfig(join(QUARTZ_DIR, "quartz.config.default.yaml"));
}

export interface PreparedSite {
  target: SiteTarget;
  /** Directory containing the built site. */
  siteDir: string;
  /** Base path the site expects to be served under ("" for root). */
  basePath: string;
  config?: QuartzConfig;
  build?: BuildSiteResult;
}

export interface PrepareSiteOptions {
  /** Skip the build and reuse the last output in .dev/sites/<id>. */
  noBuild?: boolean;
  /** Use a config file (full or overlay) instead of the target's own. */
  config?: string;
  /** Override the sandbox/output name (default: target id). */
  name?: string;
  /** Override the base path (built-dir targets need this if not at root). */
  basePath?: string;
  verbose?: boolean;
}

/**
 * Make sure a target is built and return where it lives. Throws with the
 * build log tail if the build fails.
 */
export async function prepareSite(
  targetOrSpec: SiteTarget | string,
  options: PrepareSiteOptions = {},
): Promise<PreparedSite> {
  const target =
    typeof targetOrSpec === "string"
      ? parseSiteTarget(targetOrSpec)
      : targetOrSpec;
  if (target.kind === "built-dir") {
    return {
      target,
      siteDir: target.builtDir!,
      basePath: options.basePath ?? "",
    };
  }
  const config = resolveTargetConfig(target, options.config);
  const basePath =
    options.basePath ?? basePathFromBaseUrl(config.configuration.baseUrl);
  const name = options.name ?? target.id;
  const outDir = join(SITES_ROOT, name);
  if (options.noBuild) {
    if (!existsSync(join(outDir, "index.html"))) {
      throw new Error(
        `--no-build: ${outDir} has no built site yet; drop --no-build`,
      );
    }
    return { target, siteDir: outDir, basePath, config };
  }
  const build = await buildSite({
    name,
    config,
    contentDir: target.contentDir!,
    outDir,
    verbose: options.verbose,
  });
  if (!build.ok) {
    const tail = build.log.split("\n").slice(-40).join("\n");
    throw new Error(
      `Build failed for ${target.spec} (full log: ${build.logPath})\n${tail}`,
    );
  }
  return { target, siteDir: build.outDir, basePath, config, build };
}

/** Format stale-dist warnings for terminal output. */
export function formatStaleDists(build: BuildSiteResult | undefined): string[] {
  if (!build?.staleDists.length) return [];
  return build.staleDists.map(
    (s) =>
      `⚠ ${s.name}: dist/ is ${s.reason === "missing" ? "missing" : "older than src/"} — the site used OLD code. Run: just build-plugin ${s.name}`,
  );
}
