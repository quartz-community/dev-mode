/**
 * Attribution of V8 browser coverage (Playwright `page.coverage`) to plugin
 * browser scripts. Pure logic; file discovery lives in discover.ts.
 *
 * A *script literal* is a plugin's built inline script (the text Quartz writes
 * into `static/scripts/script-N-<hash>.js`, or joins into the prescript). Its
 * functions are the denominator; a served script that contains the literal maps
 * each literal function to an offset in the served text, and a function counts
 * as executed when the innermost V8 range covering its body start has count > 0
 * in any dump.
 */
import ts from "typescript";
import type { SourceMapLookup } from "./sourcemap.js";

export interface V8Range {
  startOffset: number;
  endOffset: number;
  count: number;
}

export interface V8Function {
  functionName: string;
  isBlockCoverage: boolean;
  ranges: V8Range[];
}

export interface FunctionNode {
  /** Offset of the function node (keyword / first parameter). */
  start: number;
  end: number;
  /** Offset of the body (block or expression): used for coverage lookups. */
  bodyStart: number;
  /** Offset of the identifier naming the function, if any. */
  nameOffset?: number;
  /** The (possibly minified) name at nameOffset. */
  minName?: string;
  /** Call/assignment context that survives minification, e.g. `addEventListener("keydown")`. */
  context?: string;
  /** Minified identifier inside `context` (a callee such as `y` for `idle`), resolvable via a source map. */
  contextIdent?: { offset: number; text: string };
  params: number;
}

function isFunctionLike(node: ts.Node): node is ts.SignatureDeclaration & {
  body?: ts.Node;
} {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function shortText(node: ts.Node, sf: ts.SourceFile, max = 40): string {
  const text = node.getText(sf).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function calleeName(expr: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return shortText(expr, sf, 24);
}

function describeContext(
  node: ts.Node,
  sf: ts.SourceFile,
): {
  context?: string;
  nameNode?: ts.Node;
  contextIdent?: { offset: number; text: string };
} {
  const parent = node.parent;
  if (!parent) return {};
  if (ts.isVariableDeclaration(parent) && parent.initializer === node)
    return { nameNode: parent.name };
  if (ts.isPropertyAssignment(parent) && parent.initializer === node)
    return { context: `${shortText(parent.name, sf)}:`, nameNode: parent.name };
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const left = parent.left;
    const nameNode = ts.isPropertyAccessExpression(left) ? left.name : left;
    return { context: `${shortText(left, sf)} =`, nameNode };
  }
  if (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.arguments?.includes(node as ts.Expression)
  ) {
    const callee = calleeName(parent.expression, sf);
    const first = parent.arguments[0];
    const arg =
      first && first !== node && ts.isStringLiteralLike(first)
        ? JSON.stringify(first.text)
        : "";
    const prefix = ts.isNewExpression(parent) ? "new " : "";
    const contextIdent = ts.isIdentifier(parent.expression)
      ? { offset: parent.expression.getStart(sf), text: parent.expression.text }
      : undefined;
    return { context: `${prefix}${callee}(${arg}) callback`, contextIdent };
  }
  if (ts.isReturnStatement(parent)) return { context: "returned function" };
  return {};
}

/** Every function-like node in a script, in source order. */
export function enumerateFunctions(code: string): FunctionNode[] {
  const sf = ts.createSourceFile(
    "script.js",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const out: FunctionNode[] = [];
  const visit = (node: ts.Node) => {
    if (isFunctionLike(node) && node.body) {
      const fn: FunctionNode = {
        start: node.getStart(sf),
        end: node.end,
        bodyStart: node.body.getStart(sf),
        params: node.parameters.length,
      };
      const own = node.name;
      if (own) {
        fn.nameOffset = own.getStart(sf);
        fn.minName = own.getText(sf);
        if (
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node)
        )
          fn.context = `method ${fn.minName}`;
      } else if (ts.isConstructorDeclaration(node)) {
        fn.context = "constructor";
      }
      const { context, nameNode, contextIdent } = describeContext(node, sf);
      if (context && !fn.context) {
        fn.context = context;
        fn.contextIdent = contextIdent;
      }
      if (nameNode && fn.nameOffset === undefined) {
        fn.nameOffset = nameNode.getStart(sf);
        fn.minName = nameNode.getText(sf);
      }
      out.push(fn);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Count of the innermost V8 range covering `offset`, or undefined if none does. */
export function countAt(
  functions: V8Function[],
  offset: number,
): number | undefined {
  let best: V8Range | undefined;
  for (const fn of functions) {
    for (const r of fn.ranges) {
      if (r.startOffset <= offset && offset < r.endOffset) {
        if (
          !best ||
          r.endOffset - r.startOffset < best.endOffset - best.startOffset
        )
          best = r;
      }
    }
  }
  return best?.count;
}

export interface LiteralFunction {
  /** Offset of the function in the literal (stable key). */
  start: number;
  bodyStart: number;
  end: number;
  name: string;
  /** e.g. `explorer/src/components/scripts/explorer.inline.ts:42` */
  location?: string;
  snippet?: string;
  context?: string;
  /** In the plugin's own sources (false: bundled dependency such as utils). */
  own: boolean;
}

export interface ScriptLiteral {
  /** Unique id, e.g. `explorer:src/components/scripts/explorer.inline.ts`. */
  id: string;
  plugin: string;
  /** Display path of the entry file. */
  file: string;
  code: string;
  map?: SourceMapLookup;
  /** How the literal was obtained. */
  kind: "inline" | "dist-literal";
  /** Maps a source path from `map.sources` to a display path and ownership. */
  resolveSource?: (source: string) => { display: string; own: boolean };
  /** Set when src rebuilt ≠ dist: the built text could not be reproduced. */
  note?: string;
}

const IDENT = /^[A-Za-z_$][\w$]*/;

/** Name + location of each function in a literal, via its source map when present. */
export function literalFunctions(literal: ScriptLiteral): LiteralFunction[] {
  const fns = enumerateFunctions(literal.code);
  return fns.map((fn) => {
    const result: LiteralFunction = {
      start: fn.start,
      bodyStart: fn.bodyStart,
      end: fn.end,
      name: fn.minName ?? fn.context ?? "<anonymous>",
      context: fn.context,
      own: true,
    };
    const map = literal.map;
    if (!map) return result;
    if (fn.context && fn.contextIdent) {
      const name = map.originalFor(fn.contextIdent.offset, true)?.name;
      if (name && name !== fn.contextIdent.text) {
        fn.context = fn.context.replace(fn.contextIdent.text, name);
        result.context = fn.context;
      }
    }
    const startPos =
      map.originalFor(fn.start) ??
      (fn.nameOffset !== undefined
        ? map.originalFor(fn.nameOffset)
        : undefined);
    let original: string | undefined;
    if (fn.nameOffset !== undefined) {
      const namePos = map.originalFor(fn.nameOffset, true);
      original = namePos?.name;
      if (!original && namePos) {
        const line = map.sourceLine(namePos);
        original = line?.slice(namePos.column).match(IDENT)?.[0];
      }
    }
    const pos = startPos;
    // Unmapped code is esbuild's own runtime (e.g. `__publicField`): not the plugin's.
    if (!pos) result.own = false;
    if (pos) {
      const resolved = literal.resolveSource?.(pos.source) ?? {
        display: pos.source,
        own: true,
      };
      result.own = resolved.own;
      result.location = `${resolved.display}:${pos.line + 1}`;
      const line = map.sourceLine(pos);
      if (line) {
        const trimmed = line.trim();
        result.snippet =
          trimmed.length > 100 ? `${trimmed.slice(0, 99)}…` : trimmed;
        if (!original) {
          const m = trimmed.match(
            /(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{)/,
          );
          original = m?.[1] ?? m?.[2] ?? m?.[3];
        }
      }
    }
    if (original) result.name = original;
    else if (fn.context) result.name = fn.context;
    else result.name = "<anonymous>";
    return result;
  });
}

/** A literal found in a served script, with a mapping literal offset → served offset. */
export interface LiteralMatch {
  literalId: string;
  toServed(literalOffset: number): number | undefined;
}

/** Non-overlapping occurrences of literals inside a served script (longest first). */
export function locateLiterals(
  served: string,
  literals: Pick<ScriptLiteral, "id" | "code">[],
): LiteralMatch[] {
  const taken: [number, number][] = [];
  const matches: LiteralMatch[] = [];
  const sorted = [...literals]
    .filter((l) => l.code.trim().length > 0)
    .sort((a, b) => b.code.length - a.code.length);
  for (const lit of sorted) {
    // Built scripts end with a newline that may be trimmed when served.
    const needle = lit.code.trimEnd();
    let from = 0;
    for (;;) {
      const at = served.indexOf(needle, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + needle.length;
      if (taken.some(([s, e]) => at < e && s < end)) continue;
      taken.push([at, end]);
      matches.push({ literalId: lit.id, toServed: (o) => at + o });
    }
  }
  return matches;
}

/**
 * Quartz re-minifies some scripts: `beforeDOMLoaded` scripts are joined into the
 * prescript and every inline transformer resource (`static/resource-*.js`) is
 * minified alone, each as `(function () {[prefix]<script>})();` (componentResources
 * `joinScripts`; OFM puts `const __OFM_FOLD__ = …;` style prefixes in front). The
 * literal text is then not in the served file, but minifying minified code keeps
 * its functions and their order, so align them: per candidate (in some order) the
 * IIFE wrapper, up to `maxPrefix` prefix functions, then the literal's functions
 * with equal parameter counts. Returns undefined when no ordering aligns.
 */
export function alignJoinedScript(
  served: string,
  candidates: Pick<ScriptLiteral, "id" | "code">[],
  maxCandidates = 5,
  maxPrefix = 3,
): LiteralMatch[] | undefined {
  if (candidates.length === 0 || candidates.length > maxCandidates)
    return undefined;
  const servedFns = enumerateFunctions(served);
  const litFns = new Map(
    candidates.map((c) => [c.id, enumerateFunctions(c.code)]),
  );
  for (const subset of orderedSubsets(candidates)) {
    const total = subset.reduce((n, c) => n + 1 + litFns.get(c.id)!.length, 0);
    if (
      total > servedFns.length ||
      servedFns.length > total + maxPrefix * subset.length
    )
      continue;
    const mapped = alignSubset(
      servedFns,
      subset.map((c) => litFns.get(c.id)!),
      maxPrefix,
    );
    if (!mapped) continue;
    return subset.map((c, i) => ({
      literalId: c.id,
      toServed: (o) => mapped[i].get(o),
    }));
  }
  return undefined;
}

function alignSubset(
  served: FunctionNode[],
  literals: FunctionNode[][],
  maxPrefix: number,
): Map<number, number>[] | undefined {
  const go = (pos: number, i: number): Map<number, number>[] | undefined => {
    if (i === literals.length) return pos === served.length ? [] : undefined;
    const lit = literals[i];
    const wrapper = served[pos];
    if (!wrapper) return undefined;
    for (let k = 0; k <= maxPrefix; k += 1) {
      const from = pos + 1 + k;
      if (from + lit.length > served.length) break;
      let ok = true;
      for (let j = 0; j < lit.length && ok; j += 1) {
        const sf = served[from + j];
        ok =
          sf.params === lit[j].params &&
          sf.start >= wrapper.start &&
          sf.end <= wrapper.end;
      }
      if (!ok) continue;
      // nothing after the literal's functions may remain in this wrapper
      const next = from + lit.length;
      if (next < served.length && served[next].end <= wrapper.end) continue;
      const rest = go(next, i + 1);
      if (!rest) continue;
      const map = new Map<number, number>();
      lit.forEach((f, j) => map.set(f.bodyStart, served[from + j].bodyStart));
      return [map, ...rest];
    }
    return undefined;
  };
  return go(0, 0);
}

function* orderedSubsets<T>(items: T[]): Generator<T[]> {
  // Larger subsets first: the served script usually holds every candidate.
  const n = items.length;
  const subsets: T[][] = [];
  for (let mask = 1; mask < 1 << n; mask += 1)
    subsets.push(items.filter((_, i) => mask & (1 << i)));
  subsets.sort((a, b) => b.length - a.length);
  for (const subset of subsets) yield* permutations(subset);
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}

/**
 * Owner of a served script that matches no literal (a raw `afterDOMLoaded`
 * string in a component): the candidate text containing most of its
 * distinctive lines (≥ minShare of them).
 */
export function fingerprintOwner(
  served: string,
  candidates: { owner: string; text: string }[],
  minShare = 0.6,
): string | undefined {
  const lines = [
    ...new Set(
      served
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length >= 20),
    ),
  ];
  if (lines.length === 0) return undefined;
  let best: { owner: string; hits: number } | undefined;
  for (const c of candidates) {
    let hits = 0;
    for (const l of lines) if (c.text.includes(l)) hits += 1;
    if (!best || hits > best.hits) best = { owner: c.owner, hits };
  }
  return best && best.hits / lines.length >= minShare ? best.owner : undefined;
}

// ---------------------------------------------------------------------------

export interface CoverageEntry {
  url: string;
  sourceHash: string;
  functions: V8Function[];
}

export interface CoverageDump {
  test: string;
  file: string;
  entries: CoverageEntry[];
}

export interface FunctionResult extends LiteralFunction {
  executed: boolean;
}

export interface LiteralResult {
  literal: ScriptLiteral;
  /** Tests whose pages loaded this script. */
  tests: number;
  functions: FunctionResult[];
}

export interface UnattributedResult {
  sourceHash: string;
  url: string;
  owner?: string;
  bytes: number;
  tests: number;
  functions: (FunctionNode & { executed: boolean })[];
}

export interface CoverageAnalysis {
  literals: LiteralResult[];
  unattributed: UnattributedResult[];
  dumps: number;
}

/**
 * Merge dumps: literal functions are executed when any test executed them in any
 * served copy. `matchesFor(hash)` returns the literal matches of a served source.
 */
export function analyzeCoverage(
  literals: ScriptLiteral[],
  dumps: CoverageDump[],
  sources: Map<string, string>,
  matchesFor: (hash: string) => LiteralMatch[],
  ownerFor: (hash: string) => string | undefined = () => undefined,
): CoverageAnalysis {
  const byId = new Map(literals.map((l) => [l.id, l]));
  const results = new Map<string, LiteralResult>();
  for (const lit of literals) {
    results.set(lit.id, {
      literal: lit,
      tests: 0,
      functions: literalFunctions(lit).map((f) => ({ ...f, executed: false })),
    });
  }
  const unattributed = new Map<string, UnattributedResult>();
  for (const dump of dumps) {
    const seenLiterals = new Set<string>();
    const seenUnattributed = new Set<string>();
    for (const entry of dump.entries) {
      const matches = matchesFor(entry.sourceHash);
      for (const m of matches) {
        const res = results.get(m.literalId);
        if (!res || !byId.has(m.literalId)) continue;
        seenLiterals.add(m.literalId);
        for (const fn of res.functions) {
          if (fn.executed) continue;
          const at = m.toServed(fn.bodyStart);
          if (at === undefined) continue;
          const count = countAt(entry.functions, at);
          if (count !== undefined && count > 0) fn.executed = true;
        }
      }
      if (matches.length > 0) continue;
      const text = sources.get(entry.sourceHash);
      if (text === undefined) continue;
      let un = unattributed.get(entry.sourceHash);
      if (!un) {
        un = {
          sourceHash: entry.sourceHash,
          url: entry.url,
          owner: ownerFor(entry.sourceHash),
          bytes: text.length,
          tests: 0,
          functions: enumerateFunctions(text).map((f) => ({
            ...f,
            executed: false,
          })),
        };
        unattributed.set(entry.sourceHash, un);
      }
      seenUnattributed.add(entry.sourceHash);
      for (const fn of un.functions) {
        if (fn.executed) continue;
        const count = countAt(entry.functions, fn.bodyStart);
        if (count !== undefined && count > 0) fn.executed = true;
      }
    }
    for (const id of seenLiterals) results.get(id)!.tests += 1;
    for (const h of seenUnattributed) unattributed.get(h)!.tests += 1;
  }
  return {
    literals: [...results.values()],
    unattributed: [...unattributed.values()],
    dumps: dumps.length,
  };
}

export interface PluginSummary {
  plugin: string;
  scripts: number;
  /** Scripts that no test page loaded. */
  neverLoaded: string[];
  ownFunctions: number;
  ownExecuted: number;
  allFunctions: number;
  allExecuted: number;
  /** 0–100, own functions; null when the plugin has none. */
  percent: number | null;
}

export function summarizePlugins(analysis: CoverageAnalysis): PluginSummary[] {
  const byPlugin = new Map<string, LiteralResult[]>();
  for (const r of analysis.literals) {
    const list = byPlugin.get(r.literal.plugin) ?? [];
    list.push(r);
    byPlugin.set(r.literal.plugin, list);
  }
  const out: PluginSummary[] = [];
  for (const [plugin, list] of byPlugin) {
    const own = list.flatMap((r) => r.functions.filter((f) => f.own));
    const all = list.flatMap((r) => r.functions);
    const ownExecuted = own.filter((f) => f.executed).length;
    out.push({
      plugin,
      scripts: list.length,
      neverLoaded: list.filter((r) => r.tests === 0).map((r) => r.literal.file),
      ownFunctions: own.length,
      ownExecuted,
      allFunctions: all.length,
      allExecuted: all.filter((f) => f.executed).length,
      percent:
        own.length === 0
          ? null
          : Math.round((1000 * ownExecuted) / own.length) / 10,
    });
  }
  return out.sort(
    (a, b) =>
      (a.percent ?? 101) - (b.percent ?? 101) ||
      a.plugin.localeCompare(b.plugin),
  );
}
