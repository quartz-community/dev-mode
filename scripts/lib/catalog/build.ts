/**
 * Catalog builder: walks `repos/*`, analyses each package and aggregates the
 * workspace-wide data-flow graph, transformer pipeline and e2e coverage.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { safeReadJson } from "../json.js";
import { loadConfig, type QuartzPluginEntry } from "../sandbox.js";
import { readManifest } from "../manifest.js";
import type { Manifest } from "../types.js";
import {
  analyzeSource,
  analyzeStylesheet,
  isClientScript,
  resolvePhases,
  type FileFacts,
} from "./source-analysis.js";
import type {
  Catalog,
  DataAccess,
  DataKeyFlow,
  FixtureInfo,
  OrderHazard,
  PackageEntry,
  PackageKind,
  Phase,
  PipelineStep,
  QuartzManifestSummary,
  SpecInfo,
  WorkspaceDep,
} from "./types.js";

export interface BuildOptions {
  workspaceRoot: string;
  reposDir?: string;
  manifest?: Manifest;
  /** Only analyse these repo dirs (testing / speed). */
  only?: string[];
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  quartz?: Record<string, unknown>;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  "test",
  "tests",
  "__tests__",
  "locales",
  "static",
  "coverage",
]);
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|mjs)$/;
const SOURCE_RE = /\.(ts|tsx)$/;
const STYLE_RE = /\.(scss|css)$/;
const TRANSFORM_PHASES: Phase[] = [
  "textTransform",
  "markdownPlugins",
  "htmlPlugins",
];

export function walk(
  dir: string,
  filter: (path: string) => boolean,
  skip = SKIP_DIRS,
  out: string[] = [],
): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walk(p, filter, skip, out);
    } else if (e.isFile() && filter(p)) {
      out.push(p);
    }
  }
  return out;
}

export function classify(
  dir: string,
  manifest: Manifest,
  hasQuartzField: boolean,
): PackageKind {
  const coreDir =
    manifest.core?.name ?? manifest.core?.repo?.split("/").pop() ?? "quartz";
  if (dir === coreDir) return "core";
  if (
    manifest.infrastructure?.some(
      (r) => (r.name ?? r.repo.split("/").pop()) === dir,
    )
  )
    return "infrastructure";
  if (
    manifest.themes?.packages?.some(
      (r) => (r.name ?? r.repo.split("/").pop()) === dir,
    )
  )
    return "theme";
  if (manifest.tools?.some((r) => (r.name ?? r.repo.split("/").pop()) === dir))
    return "tool";
  if (manifest.plugins?.some((p) => p.name === dir)) return "plugin";
  return hasQuartzField ? "plugin" : "unknown";
}

export function summarizeQuartzField(
  q: Record<string, unknown> | undefined,
): QuartzManifestSummary | undefined {
  if (!q) return undefined;
  const cat = q.category;
  const components = (q.components ??
    {}) as QuartzManifestSummary["components"];
  return {
    name: q.name as string | undefined,
    displayName: q.displayName as string | undefined,
    category: Array.isArray(cat)
      ? (cat as string[])
      : typeof cat === "string"
        ? [cat]
        : [],
    defaultOrder:
      typeof q.defaultOrder === "number" ? q.defaultOrder : undefined,
    defaultEnabled:
      typeof q.defaultEnabled === "boolean" ? q.defaultEnabled : undefined,
    defaultOptionKeys: Object.keys((q.defaultOptions ?? {}) as object),
    optionSchema: q.optionSchema as Record<string, unknown> | undefined,
    components,
    frames: (q.frames ?? {}) as Record<string, unknown>,
    dependencies: Array.isArray(q.dependencies)
      ? (q.dependencies as string[])
      : [],
    requires: q.requires,
    conflicts: q.conflicts,
    requiresInstall: q.requiresInstall,
  };
}

export function readmeParagraph(text: string): string | undefined {
  const paras = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim());
  for (const p of paras) {
    if (
      !p ||
      p.startsWith("#") ||
      p.startsWith("[![") ||
      p.startsWith("![") ||
      p.startsWith("<") ||
      p.startsWith("|") ||
      p.startsWith(">")
    )
      continue;
    const flat = p
      .replace(/\s*\n\s*/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .trim();
    if (flat.length < 20) continue;
    return flat.length > 320 ? flat.slice(0, 317) + "..." : flat;
  }
  return undefined;
}

function sourceRootOf(repoDir: string, kind: PackageKind): string {
  if (kind === "core") return join(repoDir, "quartz");
  return join(repoDir, "src");
}

const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];
const sorted = (xs: Iterable<string>): string[] => uniq(xs).sort();

/** Analyse one repo directory. Workspace deps/dependents are filled in later. */
export function analyzePackage(
  repoDir: string,
  dir: string,
  kind: PackageKind,
  pkg: PackageJson,
): PackageEntry {
  const srcRoot = sourceRootOf(repoDir, kind);
  const sources = walk(
    srcRoot,
    (p) => SOURCE_RE.test(p) && !TEST_FILE_RE.test(p) && !p.endsWith(".d.ts"),
  );
  const styles = walk(srcRoot, (p) => STYLE_RE.test(p));
  const facts: FileFacts[] = [];
  for (const f of sources) {
    const rel = relative(repoDir, f);
    facts.push(
      analyzeSource(rel, readFileSync(f, "utf-8"), {
        data: kind === "tool" ? false : !isClientScript(rel),
      }),
    );
  }
  const fnPhases = resolvePhases(facts);

  const dataAccess: DataAccess[] = [];
  for (const f of facts) {
    const isComponentFile =
      f.file.endsWith(".tsx") ||
      f.file.startsWith("quartz/components/") ||
      f.file === "quartz/plugins/loader/conditions.ts";
    const isCoreParse =
      kind === "core" && f.file.startsWith("quartz/processors/");
    for (const a of f.accesses) {
      let phases: Phase[] = [];
      if (a.hook) phases = [a.hook];
      else {
        for (const fn of a.enclosing) {
          const ph = fnPhases.get(fn);
          if (ph && ph.size > 0) {
            phases = [...ph];
            break;
          }
        }
      }
      if (phases.length === 0)
        phases = [
          isCoreParse ? "parse" : isComponentFile ? "component" : "unknown",
        ];
      for (const phase of phases)
        dataAccess.push({
          key: a.key,
          mode: a.mode,
          phase,
          file: f.file,
          line: a.line,
        });
    }
  }

  const dataMap = facts.flatMap((f) => f.dataMap);
  const writes = new Set(
    dataAccess.filter((a) => a.mode === "write").map((a) => a.key),
  );
  const reads = new Set(
    dataAccess.filter((a) => a.mode === "read").map((a) => a.key),
  );
  const declared =
    kind === "infrastructure" && dir === "types"
      ? []
      : dataMap.map((d) => d.key);

  const styled = { classes: new Set<string>(), ids: new Set<string>() };
  for (const s of styles) {
    const r = analyzeStylesheet(readFileSync(s, "utf-8"));
    r.classes.forEach((c) => styled.classes.add(c));
    r.ids.forEach((c) => styled.ids.add(c));
  }

  const tests = walk(
    repoDir,
    (p) => TEST_FILE_RE.test(p),
    new Set(["node_modules", "dist", ".git", ".turbo"]),
  );
  let readme: string | undefined;
  const readmePath = join(repoDir, "README.md");
  if (existsSync(readmePath))
    readme = readmeParagraph(readFileSync(readmePath, "utf-8"));

  const indexFile = facts.find((f) =>
    /^(src\/index\.tsx?|quartz\/plugins\/index\.ts)$/.test(f.file),
  );
  const hooks = sorted(facts.flatMap((f) => [...f.hooks]));

  return {
    dir,
    npmName: pkg.name ?? dir,
    kind,
    version: pkg.version,
    description: pkg.description,
    readme,
    quartz: summarizeQuartzField(pkg.quartz),
    workspaceDeps: [],
    dependents: [],
    hooks,
    exports: indexFile?.exports ?? [],
    dataMap,
    dataAccess,
    frontmatter: facts.flatMap((f) => f.frontmatter),
    provides: sorted([...writes, ...declared]),
    consumes: sorted([...reads].filter((k) => !writes.has(k))),
    emits: facts.flatMap((f) => f.emits),
    client: {
      scripts: facts
        .filter((f) => f.file.endsWith(".inline.ts"))
        .map((f) => f.file),
      listens: sorted(facts.flatMap((f) => [...f.listens])),
      dispatches: sorted(facts.flatMap((f) => [...f.dispatches])),
      usesAddCleanup: facts.some((f) => f.usesAddCleanup),
      localStorage: sorted(facts.flatMap((f) => [...f.localStorage])),
      sessionStorage: sorted(facts.flatMap((f) => [...f.sessionStorage])),
      fetches: sorted(facts.flatMap((f) => [...f.fetches])),
    },
    dom: {
      renderedClasses: sorted(facts.flatMap((f) => [...f.renderedClasses])),
      renderedIds: sorted(facts.flatMap((f) => [...f.renderedIds])),
      styledClasses: sorted(styled.classes),
      styledIds: sorted(styled.ids),
      scriptedClasses: sorted(facts.flatMap((f) => [...f.scriptedClasses])),
      scriptedIds: sorted(facts.flatMap((f) => [...f.scriptedIds])),
      stylesheets: styles.map((s) => relative(repoDir, s)),
    },
    testFiles: tests.length,
    sourceFiles: sources.length,
    warnings: [],
  };
}

const HOOK_CATEGORY: Record<string, string> = {
  textTransform: "transformer",
  markdownPlugins: "transformer",
  htmlPlugins: "transformer",
  shouldPublish: "filter",
  emit: "emitter",
  match: "pageType",
};

/** Cheap consistency checks that tend to point at real packaging mistakes. */
export function computeWarnings(p: PackageEntry): string[] {
  const w: string[] = [];
  const example = p.exports.filter((e) => /^Example/.test(e));
  if (example.length)
    w.push(`exports plugin-template scaffolding: ${example.join(", ")}`);
  const q = p.quartz;
  if (!q || p.kind !== "plugin") return w;
  const implied = new Set(p.hooks.map((h) => HOOK_CATEGORY[h]).filter(Boolean));
  const declared = new Set(q.category);
  const undeclared = [...implied].filter((c) => !declared.has(c));
  if (undeclared.length) {
    w.push(
      `implements ${undeclared.join(", ")} hooks but quartz.category is [${q.category.join(", ")}] — Quartz will not load them as such`,
    );
  }
  for (const c of declared) {
    if (c === "component") {
      if (
        !Object.keys(q.components).length &&
        !Object.keys(q.frames).length &&
        !p.hooks.some((h) => h === "css" || h.endsWith("DOMLoaded"))
      ) {
        w.push(
          "category includes component but no components/frames are declared",
        );
      }
    } else if (!implied.has(c)) {
      w.push(`category includes ${c} but no ${c} hook was found in src/`);
    }
  }
  const missing = Object.keys(q.components).filter(
    (c) =>
      p.exports.length &&
      !p.exports.includes(c) &&
      !p.exports.some((e) => e.startsWith("* from")),
  );
  if (missing.length)
    w.push(
      `manifest components not exported from src/index.ts: ${missing.join(", ")}`,
    );
  return w;
}

export function linkWorkspaceDeps(
  entries: PackageEntry[],
  pkgs: Map<string, PackageJson>,
): void {
  const byName = new Map(entries.map((e) => [e.npmName, e]));
  for (const e of entries) {
    const pkg = pkgs.get(e.dir) ?? {};
    const deps: WorkspaceDep[] = [];
    for (const type of [
      "dependencies",
      "peerDependencies",
      "devDependencies",
    ] as const) {
      for (const name of Object.keys(pkg[type] ?? {})) {
        const target = byName.get(name);
        if (target && target.dir !== e.dir)
          deps.push({ name, dir: target.dir, type });
      }
    }
    e.workspaceDeps = deps;
  }
  for (const e of entries) {
    for (const d of e.workspaceDeps) {
      const t = entries.find((x) => x.dir === d.dir);
      if (t && !t.dependents.includes(e.dir)) t.dependents.push(e.dir);
    }
  }
  for (const e of entries) e.dependents.sort();
}

/** Infrastructure markdown processors whose data writes run inside their consumer plugin. */
function viaPhase(dep: PackageEntry): Phase | undefined {
  if (dep.kind !== "infrastructure") return undefined;
  if (dep.dir.startsWith("remark-")) return "markdownPlugins";
  if (dep.dir.startsWith("rehype-")) return "htmlPlugins";
  return undefined;
}

export function computeDataFlow(entries: PackageEntry[]): DataKeyFlow[] {
  const keys = new Map<string, DataKeyFlow>();
  const get = (k: string): DataKeyFlow => {
    let f = keys.get(k);
    if (!f)
      keys.set(
        k,
        (f = {
          key: k,
          declaredBy: [],
          producers: [],
          consumers: [],
          status: "ok",
        }),
      );
    return f;
  };
  for (const e of entries) {
    if (e.kind === "tool") continue; // Obsidian-side code; its `file.data` is unrelated
    for (const d of e.dataMap) {
      const f = get(d.key);
      if (!f.declaredBy.includes(e.dir)) f.declaredBy.push(e.dir);
      if (!f.type || e.dir === "types") f.type = d.type;
    }
    const byKey = new Map<string, { w: Set<Phase>; r: Set<Phase> }>();
    const via = viaPhase(e);
    for (const a of e.dataAccess) {
      let s = byKey.get(a.key);
      if (!s) byKey.set(a.key, (s = { w: new Set(), r: new Set() }));
      (a.mode === "write" ? s.w : s.r).add(
        a.phase === "unknown" && via ? via : a.phase,
      );
    }
    for (const [k, s] of byKey) {
      const f = get(k);
      if (s.w.size) f.producers.push({ pkg: e.dir, phases: [...s.w] });
      if (s.r.size) f.consumers.push({ pkg: e.dir, phases: [...s.r] });
    }
    // DataMap declarations by plugins count as "provides" even when the write is indirect.
    for (const d of e.dataMap) {
      if (e.dir === "types") continue;
      const f = get(d.key);
      if (!f.producers.some((p) => p.pkg === e.dir))
        f.producers.push({ pkg: e.dir, phases: ["unknown"] });
    }
  }
  for (const f of keys.values()) {
    // self-consumption (a plugin reading its own key, e.g. table-of-contents → toc) counts as consumed
    if (f.consumers.length && !f.producers.length)
      f.status = "consumed-never-produced";
    else if (f.producers.length && !f.consumers.length)
      f.status = "produced-never-consumed";
  }
  return [...keys.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function step(
  e: PackageEntry,
  all: PackageEntry[],
  restrictTo?: Phase[],
): PipelineStep {
  const writes: Record<string, Set<string>> = {};
  const reads: Record<string, Set<string>> = {};
  const add = (
    rec: Record<string, Set<string>>,
    phase: string,
    key: string,
  ) => {
    (rec[phase] ??= new Set()).add(key);
  };
  for (const a of e.dataAccess) {
    if (restrictTo && !restrictTo.includes(a.phase)) continue;
    add(a.mode === "write" ? writes : reads, a.phase, a.key);
  }
  // inline remark-/rehype- infrastructure that this plugin depends on
  for (const d of e.workspaceDeps) {
    const dep = all.find((x) => x.dir === d.dir);
    const ph = dep && viaPhase(dep);
    if (!dep || !ph || (restrictTo && !restrictTo.includes(ph))) continue;
    for (const a of dep.dataAccess)
      add(a.mode === "write" ? writes : reads, ph, `${a.key} (via ${dep.dir})`);
  }
  const toObj = (r: Record<string, Set<string>>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [...v].sort()]));
  const phases = e.hooks.filter(
    (h) => !restrictTo || restrictTo.includes(h as Phase),
  ) as Phase[];
  return {
    pkg: e.dir,
    order: e.quartz?.defaultOrder ?? 50,
    phases,
    writes: toObj(writes),
    reads: toObj(reads),
  };
}

export function computePipeline(entries: PackageEntry[]): Catalog["pipeline"] {
  const by = (cat: string) =>
    entries
      .filter((e) => e.quartz?.category.includes(cat))
      .sort(
        (a, b) =>
          (a.quartz?.defaultOrder ?? 50) - (b.quartz?.defaultOrder ?? 50) ||
          a.dir.localeCompare(b.dir),
      );
  return {
    transformers: by("transformer").map((e) =>
      step(e, entries, [...TRANSFORM_PHASES, "unknown"]),
    ),
    filters: by("filter").map((e) => step(e, entries, ["shouldPublish"])),
    emitters: by("emitter").map((e) =>
      step(e, entries, ["emit", "partialEmit", "getQuartzComponents"]),
    ),
    pageTypes: by("pageType").map((e) =>
      step(e, entries, [
        "match",
        "generate",
        "body",
        "treeTransforms",
        "component",
      ]),
    ),
  };
}

/**
 * Transformers run phase-by-phase: every textTransform, then all
 * markdownPlugins (sorted by order), then all htmlPlugins. A transformer that
 * reads a key in phase P at order o needs a producer at (phase, order) < (P, o).
 */
export function computeHazards(
  pipeline: Catalog["pipeline"],
  entries: PackageEntry[],
): OrderHazard[] {
  const coreWrites = new Set(
    entries
      .filter((e) => e.kind === "core")
      .flatMap((e) =>
        e.dataAccess.filter((a) => a.mode === "write").map((a) => a.key),
      ),
  );
  const idx = (p: string) => TRANSFORM_PHASES.indexOf(p as Phase);
  const producers = new Map<
    string,
    { pkg: string; phase: Phase; order: number }[]
  >();
  const strip = (k: string) => k.replace(/ \(via .*\)$/, "");
  for (const s of pipeline.transformers) {
    for (const [phase, keys] of Object.entries(s.writes)) {
      if (idx(phase) < 0) continue;
      for (const k of keys) {
        const list = producers.get(strip(k)) ?? [];
        list.push({ pkg: s.pkg, phase: phase as Phase, order: s.order });
        producers.set(strip(k), list);
      }
    }
  }
  const hazards: OrderHazard[] = [];
  for (const s of pipeline.transformers) {
    for (const [phase, keys] of Object.entries(s.reads)) {
      if (idx(phase) < 0) continue;
      for (const raw of keys) {
        const k = strip(raw);
        if (coreWrites.has(k)) continue;
        const prods = (producers.get(k) ?? []).filter((p) => p.pkg !== s.pkg);
        if (!prods.length) continue;
        const before = prods.filter(
          (p) =>
            idx(p.phase) < idx(phase) ||
            (idx(p.phase) === idx(phase) && p.order < s.order),
        );
        if (before.length) continue;
        for (const p of prods) {
          hazards.push({
            consumer: s.pkg,
            consumerPhase: phase as Phase,
            consumerOrder: s.order,
            key: k,
            producer: p.pkg,
            producerPhase: p.phase,
            producerOrder: p.order,
            message: `${s.pkg} reads \`${k}\` in ${phase} (order ${s.order}) but ${p.pkg} only writes it in ${p.phase} (order ${p.order}) — runs later or tied`,
          });
        }
      }
    }
  }
  return hazards;
}

export function computeMultiWriters(
  pipeline: Catalog["pipeline"],
): Catalog["multiWriters"] {
  const idx = (p: string) => TRANSFORM_PHASES.indexOf(p as Phase);
  const m = new Map<string, { pkg: string; phase: Phase; order: number }[]>();
  for (const s of pipeline.transformers) {
    for (const [phase, keys] of Object.entries(s.writes)) {
      if (idx(phase) < 0) continue;
      for (const raw of keys) {
        const k = raw.replace(/ \(via .*\)$/, "");
        const list = m.get(k) ?? [];
        if (!list.some((x) => x.pkg === s.pkg))
          list.push({ pkg: s.pkg, phase: phase as Phase, order: s.order });
        m.set(k, list);
      }
    }
  }
  return [...m.entries()]
    .filter(([, ws]) => ws.length > 1)
    .map(([key, ws]) => ({
      key,
      writers: ws.sort(
        (a, b) => idx(a.phase) - idx(b.phase) || a.order - b.order,
      ),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function resolveSourceToDir(
  source: string,
  entries: PackageEntry[],
): string {
  const s = source
    .replace(/^(github:|npm:|git\+https:\/\/github\.com\/)/, "")
    .replace(/\.git$/, "")
    .replace(/#.*$/, "");
  const byName = entries.find((e) => e.npmName === s);
  if (byName) return byName.dir;
  const last = s.split("/").pop() ?? s;
  const byDir = entries.find(
    (e) => e.dir === last || e.npmName.split("/").pop() === last,
  );
  return byDir ? byDir.dir : s;
}

export function readFixtures(
  workspaceRoot: string,
  entries: PackageEntry[],
): FixtureInfo[] {
  const out: FixtureInfo[] = [];
  for (const [sub, kind] of [
    ["e2e/fixtures", "fixture"],
    ["e2e/repros", "repro"],
  ] as const) {
    const base = join(workspaceRoot, sub);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const cfgPath = join(base, name, "quartz.config.yaml");
      // Repros may omit the config (default config) or use an overlay
      // (`extends:` / plugins map); loadConfig resolves both to a full config.
      const defaultCfg = join(
        workspaceRoot,
        "repos/quartz/quartz.config.default.yaml",
      );
      const effective = existsSync(cfgPath)
        ? cfgPath
        : kind === "repro"
          ? defaultCfg
          : undefined;
      if (!effective || !existsSync(effective)) continue;
      let cfg: { plugins?: QuartzPluginEntry[] } = {};
      try {
        cfg = loadConfig(effective);
      } catch {
        try {
          cfg = (parseYaml(readFileSync(effective, "utf-8")) ??
            {}) as typeof cfg;
        } catch {
          continue;
        }
      }
      if (!Array.isArray(cfg.plugins)) continue;
      const plugins = cfg.plugins
        .filter((p) => p && typeof p.source === "string" && p.enabled !== false)
        .map((p) => resolveSourceToDir(p.source as string, entries));
      out.push({ name, kind, dir: `${sub}/${name}`, plugins: sorted(plugins) });
    }
  }
  return out;
}

export function readSpecs(
  workspaceRoot: string,
  fixtures: FixtureInfo[],
): SpecInfo[] {
  const dir = join(workspaceRoot, "e2e/tests");
  if (!existsSync(dir)) return [];
  // map ports → fixture names from playwright config
  const portToFixture = new Map<string, string>();
  const cfgPath = join(workspaceRoot, "e2e/playwright.config.ts");
  if (existsSync(cfgPath)) {
    const cfg = readFileSync(cfgPath, "utf-8");
    for (const m of cfg.matchAll(
      /FIXTURE:\s*"([^"]+)"[\s\S]*?PORT:\s*"(\d+)"/g,
    ))
      portToFixture.set(m[2], m[1]);
  }
  const out: SpecInfo[] = [];
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".spec.ts"))
    .sort()) {
    const text = readFileSync(join(dir, f), "utf-8");
    const fx = new Set<string>();
    for (const [port, name] of portToFixture)
      if (text.includes(`:${port}`)) fx.add(name);
    for (const fixture of fixtures)
      if (text.includes(fixture.name)) fx.add(fixture.name);
    out.push({ file: `e2e/tests/${f}`, fixtures: [...fx].sort() });
  }
  return out;
}

export function buildCatalog(opts: BuildOptions): Catalog {
  const t0 = Date.now();
  const reposDir = opts.reposDir ?? join(opts.workspaceRoot, "repos");
  const manifest =
    opts.manifest ?? readManifest(join(opts.workspaceRoot, "dev.yaml"));
  const dirs = readdirSync(reposDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && existsSync(join(reposDir, d.name, "package.json")),
    )
    .map((d) => d.name)
    .filter((d) => !opts.only || opts.only.includes(d))
    .sort();
  const pkgs = new Map<string, PackageJson>();
  const entries: PackageEntry[] = [];
  for (const dir of dirs) {
    const repoDir = join(reposDir, dir);
    let pkg: PackageJson;
    try {
      pkg = safeReadJson<PackageJson>(join(repoDir, "package.json"));
    } catch {
      continue;
    }
    pkgs.set(dir, pkg);
    entries.push(
      analyzePackage(repoDir, dir, classify(dir, manifest, !!pkg.quartz), pkg),
    );
  }
  linkWorkspaceDeps(entries, pkgs);
  for (const e of entries) e.warnings = computeWarnings(e);
  const dataFlow = computeDataFlow(entries);
  const pipeline = computePipeline(entries);
  const hazards = computeHazards(pipeline, entries);
  const multiWriters = computeMultiWriters(pipeline);
  const fixtures = readFixtures(opts.workspaceRoot, entries);
  const specs = readSpecs(opts.workspaceRoot, fixtures);
  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    packages: entries,
    dataFlow,
    pipeline,
    hazards,
    multiWriters,
    fixtures,
    specs,
  };
}

/** Newest mtime of any analysed input (sources, styles, package.json, e2e configs). */
export function newestInputMtime(
  workspaceRoot: string,
  reposDir = join(workspaceRoot, "repos"),
): number {
  let newest = 0;
  const bump = (p: string) => {
    try {
      const m = statSync(p).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      /* ignore */
    }
  };
  for (const d of readdirSync(reposDir)) {
    const repo = join(reposDir, d);
    bump(join(repo, "package.json"));
    for (const root of [join(repo, "src"), join(repo, "quartz")]) {
      for (const f of walk(root, (p) => SOURCE_RE.test(p) || STYLE_RE.test(p)))
        bump(f);
    }
  }
  for (const f of walk(
    join(workspaceRoot, "e2e"),
    (p) => /\.(ya?ml|ts)$/.test(p),
    new Set(["node_modules"]),
  ))
    bump(f);
  bump(join(workspaceRoot, "dev.yaml"));
  return newest;
}
