/**
 * Find plugin browser scripts (`*.inline.ts`) and reproduce their built text with
 * source maps, so served `static/scripts/script-N-*.js` / prescript code can be
 * attributed to a plugin and its functions named.
 *
 * Plugins build inline scripts in tsup (`inline-script-loader`: esbuild bundle +
 * minify, no source map) and embed the result as `<name>_inline_default` string
 * literals in dist/. We rebuild each one with the plugin's own esbuild and the
 * same options plus `sourcemap: "external"` (which does not change the code) and
 * keep the rebuild only when it equals the dist literal; otherwise (stale dist or
 * custom loader) the dist literal is used without names.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { ScriptLiteral } from "./analyze.js";
import { SourceMapLookup, type RawSourceMap } from "./sourcemap.js";

interface EsbuildLike {
  version: string;
  build(options: Record<string, unknown>): Promise<{
    outputFiles?: { path: string; text: string }[];
  }>;
}

function loadEsbuild(fromDir: string): EsbuildLike {
  const req = createRequire(join(fromDir, "package.json"));
  return req("esbuild") as EsbuildLike;
}

function walk(dir: string, filter: (path: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(path, filter));
    else if (filter(path)) out.push(path);
  }
  return out;
}

/** `<stem>_inline_default` string literals declared at the top level of a dist bundle. */
export function extractInlineLiterals(distCode: string): Map<string, string> {
  const sf = ts.createSourceFile(
    "dist.js",
    distCode,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const out = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const name = decl.name.text;
      if (!/_inline_default\d*$/.test(name)) continue;
      const init = decl.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
        out.set(name, init.text);
    }
  }
  return out;
}

/** The dist variable name esbuild derives from an inline script file name. */
export function inlineVarStem(file: string): string {
  return `${basename(file)
    .replace(/\.inline\.(ts|js)$/, "")
    .replace(/[^\w$]/g, "_")}_inline_default`;
}

interface RebuildOptions {
  esbuild: EsbuildLike;
  file: string;
  /** Directory sourcefile paths are relative to (tsup's cwd). */
  workDir: string;
  stripExports: (text: string) => string;
  extra: Record<string, unknown>;
}

async function rebuild(
  o: RebuildOptions,
): Promise<{ code: string; map: RawSourceMap } | undefined> {
  const text = o.stripExports(readFileSync(o.file, "utf-8"));
  const result = await o.esbuild.build({
    stdin: {
      contents: text,
      loader: "ts",
      resolveDir: dirname(o.file),
      sourcefile: relative(o.workDir, o.file),
    },
    write: false,
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    sourcemap: "external",
    outfile: join(o.workDir, "__e2e_coverage__.js"),
    logLevel: "silent",
    ...o.extra,
  });
  const files = result.outputFiles ?? [];
  const js = files.find((f) => f.path.endsWith(".js"));
  const map = files.find((f) => f.path.endsWith(".map"));
  if (!js || !map) return undefined;
  return { code: js.text, map: JSON.parse(map.text) as RawSourceMap };
}

function sourceResolver(
  plugin: string,
  pluginDir: string,
  reposDir: string,
  entryRel: string,
): (source: string) => { display: string; own: boolean } {
  return (source) => {
    if (source === entryRel || source.endsWith(`/${entryRel}`))
      return { display: `${plugin}/${entryRel}`, own: true };
    const abs = resolve(pluginDir, source);
    const nm = abs.lastIndexOf(`${sep}node_modules${sep}`);
    if (nm >= 0) {
      const rest = abs.slice(nm + "/node_modules/".length);
      return {
        display: rest.replace(/^\.pnpm\/[^/]+\/node_modules\//, ""),
        own: false,
      };
    }
    if (abs.startsWith(pluginDir + sep)) {
      return {
        display: `${plugin}/${relative(pluginDir, abs)}`,
        own: true,
      };
    }
    return { display: relative(reposDir, abs), own: false };
  };
}

const PLUGIN_STRIP = (t: string) =>
  t.replace(/^export default /gm, "").replace(/^export /gm, "");
const CORE_STRIP = (t: string) =>
  t.replace("export default", "").replace("export", "");

export interface DiscoverResult {
  literals: ScriptLiteral[];
  /** Plugin dist texts, for fingerprinting raw (non-`.inline.ts`) scripts. */
  distTexts: { owner: string; text: string }[];
  warnings: string[];
}

/** Discover every plugin's (and Quartz core's) browser scripts under repos/. */
export async function discoverLiterals(
  reposDir: string,
  onlyPlugins?: Set<string>,
): Promise<DiscoverResult> {
  const literals: ScriptLiteral[] = [];
  const distTexts: { owner: string; text: string }[] = [];
  const warnings: string[] = [];
  const dirs = readdirSync(reposDir)
    .filter((d) => !onlyPlugins || onlyPlugins.has(d))
    .sort();
  for (const plugin of dirs) {
    const pluginDir = join(reposDir, plugin);
    if (!existsSync(join(pluginDir, "package.json"))) continue;
    if (plugin === "quartz") {
      literals.push(...(await coreLiterals(pluginDir, reposDir, warnings)));
      const coreTexts = walk(
        join(pluginDir, "quartz"),
        (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p),
      ).map((p) => readFileSync(p, "utf-8"));
      distTexts.push({ owner: "quartz", text: coreTexts.join("\n") });
      continue;
    }
    const inlineFiles = walk(join(pluginDir, "src"), (p) =>
      /\.inline\.ts$/.test(p),
    );
    const distFiles = walk(join(pluginDir, "dist"), (p) => p.endsWith(".js"));
    const distCode = distFiles.map((p) => readFileSync(p, "utf-8"));
    if (distCode.length)
      distTexts.push({ owner: plugin, text: distCode.join("\n") });
    if (inlineFiles.length === 0) continue;
    const distLiterals = new Map<string, Set<string>>();
    for (const code of distCode) {
      for (const [name, text] of extractInlineLiterals(code)) {
        const stem = name.replace(/\d+$/, "");
        const set = distLiterals.get(stem) ?? new Set<string>();
        set.add(text);
        distLiterals.set(stem, set);
      }
    }
    let esbuild: EsbuildLike | undefined;
    try {
      esbuild = loadEsbuild(pluginDir);
    } catch {
      warnings.push(
        `${plugin}: esbuild not resolvable; using dist literals only`,
      );
    }
    for (const file of inlineFiles) {
      const entryRel = relative(pluginDir, file);
      const id = `${plugin}:${entryRel}`;
      const dist = [...(distLiterals.get(inlineVarStem(file)) ?? [])];
      let built: { code: string; map: RawSourceMap } | undefined;
      if (esbuild) {
        for (const extra of [
          { target: "es2020", external: ["http://*", "https://*"] },
          { target: "es2020" },
          {},
        ]) {
          try {
            const r = await rebuild({
              esbuild,
              file,
              workDir: pluginDir,
              stripExports: PLUGIN_STRIP,
              extra,
            });
            if (r && (dist.length === 0 || dist.includes(r.code))) {
              built = r;
              break;
            }
          } catch (error) {
            warnings.push(
              `${id}: rebuild failed (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
            );
            break;
          }
        }
      }
      if (built && (dist.length === 0 || dist.includes(built.code))) {
        literals.push({
          id,
          plugin,
          file: `${plugin}/${entryRel}`,
          code: built.code,
          map: new SourceMapLookup(built.map, built.code),
          kind: "inline",
          resolveSource: sourceResolver(plugin, pluginDir, reposDir, entryRel),
          note:
            dist.length === 0 ? "no dist literal found (unbuilt?)" : undefined,
        });
      } else if (dist.length > 0) {
        dist.forEach((code, i) =>
          literals.push({
            id: dist.length > 1 ? `${id}#${i}` : id,
            plugin,
            file: `${plugin}/${entryRel}`,
            code,
            kind: "dist-literal",
            note: "dist/ differs from a rebuild of src/ (stale dist?): minified names only",
          }),
        );
      }
    }
  }
  return { literals, distTexts, warnings };
}

async function coreLiterals(
  quartzDir: string,
  reposDir: string,
  warnings: string[],
): Promise<ScriptLiteral[]> {
  const dir = join(quartzDir, "quartz", "components", "scripts");
  const files = walk(dir, (p) => /\.inline\.(ts|js)$/.test(p));
  if (files.length === 0) return [];
  let esbuild: EsbuildLike;
  try {
    esbuild = loadEsbuild(quartzDir);
  } catch {
    warnings.push("quartz: esbuild not resolvable; core scripts skipped");
    return [];
  }
  const out: ScriptLiteral[] = [];
  for (const file of files) {
    const entryRel = relative(quartzDir, file);
    try {
      const r = await rebuild({
        esbuild,
        file,
        workDir: quartzDir,
        stripExports: CORE_STRIP,
        extra: {},
      });
      if (!r) continue;
      out.push({
        id: `quartz:${entryRel}`,
        plugin: "quartz",
        file: `quartz/${entryRel}`,
        code: r.code,
        map: new SourceMapLookup(r.map, r.code),
        kind: "inline",
        resolveSource: sourceResolver("quartz", quartzDir, reposDir, entryRel),
      });
    } catch (error) {
      warnings.push(
        `quartz:${entryRel}: rebuild failed (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
      );
    }
  }
  return out;
}

/** String and template literal texts (≥ 5 chars) in a script: a cheap fingerprint for re-minified candidates. */
export function stringTokens(code: string): string[] {
  const sf = ts.createSourceFile(
    "script.js",
    code,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (node.text.length >= 5) out.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...out];
}
