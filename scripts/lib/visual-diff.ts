/**
 * Pure logic for visual regression: style snapshots, style diffs, thresholds
 * and report rendering. No browser or filesystem access here (unit-tested in
 * tests/visual*.test.ts).
 */
import {
  STYLE_PROPS,
  buildKeys,
  compactStyles,
  styleValue,
  SNAPSHOT_SKIP_PROPS,
  type RawNode,
} from "./page-probe.js";

// ---------------------------------------------------------------------------
// Snapshot model
// ---------------------------------------------------------------------------

export interface SnapElement {
  key: string;
  parent?: string;
  /** [x, y, width, height] in CSS px, page coordinates. */
  box: [number, number, number, number];
  visible: boolean;
  text?: string;
  /** Curated computed styles, defaults omitted (see STYLE_DEFAULTS). */
  styles: Record<string, string>;
}

export interface StyleSnapshot {
  shot: string;
  page: string;
  viewport: string;
  theme: string;
  docHeight: number;
  truncated: boolean;
  rootVars: Record<string, string>;
  elements: SnapElement[];
}

export const SNAPSHOT_PROPS: string[] = STYLE_PROPS.filter(
  (p) => !SNAPSHOT_SKIP_PROPS.has(p),
);

/** Turn raw browser nodes into a keyed, compacted snapshot. */
export function toSnapshot(
  meta: Omit<
    StyleSnapshot,
    "elements" | "rootVars" | "truncated" | "docHeight"
  >,
  raw: {
    nodes: RawNode[];
    truncated: boolean;
    rootVars: Record<string, string>;
    docHeight: number;
  },
): StyleSnapshot {
  const keys = buildKeys(raw.nodes);
  return {
    ...meta,
    docHeight: raw.docHeight,
    truncated: raw.truncated,
    rootVars: raw.rootVars,
    elements: raw.nodes.map((node, i) => ({
      key: keys[i],
      parent: node.parent >= 0 ? keys[node.parent] : undefined,
      box: node.box,
      visible: node.visible,
      ...(node.text ? { text: node.text } : {}),
      styles: compactStyles(node.styles),
    })),
  };
}

/** Shot id used for file names and matching: "<page>@<viewport>-<theme>". */
export function shotId(
  pageFile: string,
  viewport: string,
  theme: string,
): string {
  return `${pageFile}@${viewport}-${theme}`;
}

// ---------------------------------------------------------------------------
// Style diff
// ---------------------------------------------------------------------------

export interface PropChange {
  prop: string;
  before: string;
  after: string;
}

export interface ElementChange {
  key: string;
  changes: PropChange[];
  /** Descendants with the exact same change that were folded into this one. */
  inherited: number;
}

export interface BoxChange {
  key: string;
  before: [number, number, number, number];
  after: [number, number, number, number];
  /** Descendants that moved by the same delta and were folded in. */
  followers: number;
}

export interface SnapshotDiff {
  shot: string;
  varChanges: PropChange[];
  styleChanges: ElementChange[];
  moved: BoxChange[];
  resized: BoxChange[];
  appeared: string[];
  disappeared: string[];
  visibilityChanged: { key: string; before: boolean; after: boolean }[];
  truncated: boolean;
}

export interface DiffOptions {
  /** Ignore box deltas smaller than this (px). Default 1. */
  boxTolerance?: number;
}

function changeSig(c: PropChange): string {
  return `${c.prop}\u0000${c.before}\u0000${c.after}`;
}

/** Keep only the topmost element of each folded group; count descendants. */
function foldByAncestor<T>(
  items: Map<string, T>,
  parentOf: Map<string, string | undefined>,
  same: (child: T, parent: T) => boolean,
): Map<string, { item: T; folded: number }> {
  const result = new Map<string, { item: T; folded: number }>();
  const rootOf = new Map<string, string>();
  for (const [key, item] of items) {
    // Fold into the parent's group when the parent has the same change.
    const p = parentOf.get(key);
    const pItem = p !== undefined ? items.get(p) : undefined;
    const root =
      p !== undefined && pItem !== undefined && same(item, pItem)
        ? (rootOf.get(p) ?? p)
        : undefined;
    if (root !== undefined && result.has(root)) {
      rootOf.set(key, root);
      result.get(root)!.folded += 1;
    } else {
      rootOf.set(key, key);
      result.set(key, { item, folded: 0 });
    }
  }
  return result;
}

/**
 * Diff two style snapshots of the same shot. Changes inherited unchanged by
 * descendants (e.g. a color set on a container) are folded into the topmost
 * element, so one CSS edit produces one line, not hundreds.
 */
export function diffSnapshots(
  base: StyleSnapshot,
  head: StyleSnapshot,
  options: DiffOptions = {},
): SnapshotDiff {
  const tol = options.boxTolerance ?? 1;
  const baseMap = new Map(base.elements.map((e) => [e.key, e]));
  const headMap = new Map(head.elements.map((e) => [e.key, e]));
  const parentOf = new Map<string, string | undefined>();
  for (const e of [...base.elements, ...head.elements])
    parentOf.set(e.key, e.parent);

  const varChanges: PropChange[] = [];
  const varNames = [
    ...new Set([...Object.keys(base.rootVars), ...Object.keys(head.rootVars)]),
  ].sort();
  for (const name of varNames) {
    const before = base.rootVars[name] ?? "(unset)";
    const after = head.rootVars[name] ?? "(unset)";
    if (before !== after) varChanges.push({ prop: name, before, after });
  }

  const styleItems = new Map<string, PropChange[]>();
  const boxMoves = new Map<string, BoxChange>();
  const boxResizes = new Map<string, BoxChange>();
  const visibilityChanged: SnapshotDiff["visibilityChanged"] = [];
  const appeared: string[] = [];
  const disappeared: string[] = [];

  for (const [key, b] of baseMap) {
    const h = headMap.get(key);
    if (!h) {
      disappeared.push(key);
      continue;
    }
    const changes: PropChange[] = [];
    const props = [
      ...new Set([...Object.keys(b.styles), ...Object.keys(h.styles)]),
    ];
    props.sort((x, y) => SNAPSHOT_PROPS.indexOf(x) - SNAPSHOT_PROPS.indexOf(y));
    for (const prop of props) {
      const before = styleValue(b.styles, prop);
      const after = styleValue(h.styles, prop);
      if (before !== after) changes.push({ prop, before, after });
    }
    if (changes.length) styleItems.set(key, changes);
    if (b.visible !== h.visible)
      visibilityChanged.push({ key, before: b.visible, after: h.visible });
    if (!b.visible && !h.visible) continue;
    const [bx, by, bw, bh] = b.box;
    const [hx, hy, hw, hh] = h.box;
    if (Math.abs(bw - hw) >= tol || Math.abs(bh - hh) >= tol) {
      boxResizes.set(key, { key, before: b.box, after: h.box, followers: 0 });
    } else if (Math.abs(bx - hx) >= tol || Math.abs(by - hy) >= tol) {
      boxMoves.set(key, { key, before: b.box, after: h.box, followers: 0 });
    }
  }
  for (const key of headMap.keys()) if (!baseMap.has(key)) appeared.push(key);

  const sameChanges = (child: PropChange[], parent: PropChange[]) => {
    const parentSigs = new Set(parent.map(changeSig));
    return child.every((c) => parentSigs.has(changeSig(c)));
  };
  const foldedStyles = foldByAncestor(styleItems, parentOf, sameChanges);
  const styleChanges: ElementChange[] = [...foldedStyles].map(
    ([key, { item, folded }]) => ({
      key,
      changes: item,
      inherited: folded,
    }),
  );

  // Moves: fold descendants that moved by the same delta, or that sit inside a
  // resized/moved ancestor (they are consequences, not causes).
  const delta = (c: BoxChange) =>
    `${c.after[0] - c.before[0]},${c.after[1] - c.before[1]}`;
  // Insert in document (BFS) order so ancestors are seen before descendants.
  const allBox = new Map<string, BoxChange>();
  for (const e of base.elements) {
    const c = boxResizes.get(e.key) ?? boxMoves.get(e.key);
    if (c) allBox.set(e.key, c);
  }
  const foldedBoxes = foldByAncestor(
    allBox,
    parentOf,
    (child, parent) =>
      delta(child) === delta(parent) || boxResizes.has(parent.key),
  );
  const moved: BoxChange[] = [];
  const resized: BoxChange[] = [];
  for (const [key, { item, folded }] of foldedBoxes) {
    const entry = { ...item, followers: folded };
    (boxResizes.has(key) ? resized : moved).push(entry);
  }
  const groupedMoves = groupSiblingMoves(moved, parentOf);

  const foldList = (keys: string[]) => {
    const set = new Set(keys);
    return keys.filter((k) => {
      for (let p = parentOf.get(k); p !== undefined; p = parentOf.get(p))
        if (set.has(p)) return false;
      return true;
    });
  };

  return {
    shot: head.shot,
    varChanges,
    styleChanges,
    moved: groupedMoves,
    resized,
    appeared: foldList(appeared),
    disappeared: foldList(disappeared),
    visibilityChanged,
    truncated: base.truncated || head.truncated,
  };
}

/**
 * Collapse ≥3 siblings that moved by the same delta into one entry keyed
 * "<parent> > *[N siblings]" (e.g. every list item shifted down by 6px).
 */
export function groupSiblingMoves(
  moves: BoxChange[],
  parentOf: Map<string, string | undefined>,
  minGroup = 3,
): BoxChange[] {
  const groups = new Map<string, BoxChange[]>();
  for (const m of moves) {
    const sig = `${parentOf.get(m.key) ?? ""}\u0000${m.after[0] - m.before[0]},${m.after[1] - m.before[1]}`;
    const list = groups.get(sig) ?? [];
    list.push(m);
    groups.set(sig, list);
  }
  const out: BoxChange[] = [];
  const emitted = new Set<string>();
  for (const m of moves) {
    const sig = `${parentOf.get(m.key) ?? ""}\u0000${m.after[0] - m.before[0]},${m.after[1] - m.before[1]}`;
    const list = groups.get(sig)!;
    if (list.length < minGroup) {
      out.push(m);
      continue;
    }
    if (emitted.has(sig)) continue;
    emitted.add(sig);
    const parent = parentOf.get(m.key);
    out.push({
      ...m,
      key: `${parent ?? "(root)"} > *[${list.length} siblings]`,
      followers: list.reduce((n, x) => n + x.followers, 0),
    });
  }
  return out;
}

export function diffChangeCount(diff: SnapshotDiff): number {
  return (
    diff.varChanges.length +
    diff.styleChanges.length +
    diff.moved.length +
    diff.resized.length +
    diff.appeared.length +
    diff.disappeared.length +
    diff.visibilityChanged.length
  );
}

// ---------------------------------------------------------------------------
// Pixel results & threshold
// ---------------------------------------------------------------------------

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelResult {
  shot: string;
  changedPixels: number;
  totalPixels: number;
  ratio: number;
  baseSize: [number, number];
  headSize: [number, number];
  regions: Region[];
  diffImage?: string;
}

export interface CompareSummary {
  pixelFailures: string[];
  styleFailures: string[];
  missingInHead: string[];
  missingInBase: string[];
  failed: boolean;
}

export function summarizeCompare(
  pixels: PixelResult[],
  diffs: SnapshotDiff[],
  missingInHead: string[],
  missingInBase: string[],
  opts: { threshold: number; pixelsOnly?: boolean },
): CompareSummary {
  const pixelFailures = pixels
    .filter((p) => exceedsThreshold(p, opts.threshold))
    .map((p) => p.shot);
  const styleFailures = opts.pixelsOnly
    ? []
    : diffs.filter((d) => diffChangeCount(d) > 0).map((d) => d.shot);
  return {
    pixelFailures,
    styleFailures,
    missingInHead,
    missingInBase,
    failed:
      pixelFailures.length +
        styleFailures.length +
        missingInHead.length +
        missingInBase.length >
      0,
  };
}

/** A shot fails when its changed-pixel ratio exceeds the threshold or its size changed. */
export function exceedsThreshold(p: PixelResult, threshold: number): boolean {
  const sizeChanged =
    p.baseSize[0] !== p.headSize[0] || p.baseSize[1] !== p.headSize[1];
  return sizeChanged || p.ratio > threshold;
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

const fmtBox = (b: [number, number, number, number]) =>
  `${b[2]}×${b[3]} @ (${b[0]},${b[1]})`;
const pct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.0001 ? 4 : 2)}%`;

function limited<T>(
  items: T[],
  max: number,
  render: (t: T) => string,
): string[] {
  const lines = items.slice(0, max).map(render);
  if (items.length > max) lines.push(`- … and ${items.length - max} more`);
  return lines;
}

function varSig(changes: PropChange[]): string {
  return changes.map(changeSig).join("\u0001");
}

export interface StyleChangeGroup {
  changes: PropChange[];
  keys: string[];
  inherited: number;
}

/**
 * Group element changes by their exact change set, so "color A → B on 47
 * links" is one entry. Ordered by number of elements, then first key.
 */
export function groupStyleChanges(
  changes: ElementChange[],
): StyleChangeGroup[] {
  const groups = new Map<string, StyleChangeGroup>();
  for (const e of changes) {
    const sig = e.changes.map(changeSig).join("\u0001");
    const g = groups.get(sig) ?? { changes: e.changes, keys: [], inherited: 0 };
    g.keys.push(e.key);
    g.inherited += e.inherited;
    groups.set(sig, g);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.keys.length - a.keys.length || a.keys[0].localeCompare(b.keys[0]),
  );
}

/** Render one shot's style diff as markdown lines (without heading). */
export function renderDiffBody(
  diff: SnapshotDiff,
  maxItems = 40,
  sampleKeys = 6,
  /** Signature of root-var changes already shown in the overview. */
  overviewVarSig?: string,
): string[] {
  const out: string[] = [];
  if (diff.varChanges.length && overviewVarSig === varSig(diff.varChanges)) {
    out.push(
      `**Root custom properties**: same ${diff.varChanges.length} changes as the overview`,
    );
  } else if (diff.varChanges.length) {
    out.push("**Root custom properties**");
    out.push(
      ...limited(
        diff.varChanges,
        maxItems,
        (c) => `- \`${c.prop}\`: \`${c.before}\` → \`${c.after}\``,
      ),
    );
  }
  if (diff.styleChanges.length) {
    const groups = groupStyleChanges(diff.styleChanges);
    out.push(
      `**Computed style changes** (${diff.styleChanges.length} elements, ${groups.length} distinct changes)`,
    );
    out.push(
      ...limited(groups, maxItems, (g) => {
        const what = g.changes
          .map((c) => `${c.prop}: \`${c.before}\` → \`${c.after}\``)
          .join("; ");
        const lines = [
          `- ${what} — ${g.keys.length} element${g.keys.length === 1 ? "" : "s"}${g.inherited ? ` (+${g.inherited} inheriting descendants)` : ""}`,
        ];
        for (const key of g.keys.slice(0, sampleKeys))
          lines.push(`  - \`${key}\``);
        if (g.keys.length > sampleKeys) {
          lines.push(`  - … ${g.keys.length - sampleKeys} more (summary.json)`);
        }
        return lines.join("\n");
      }),
    );
  }
  if (diff.resized.length) {
    out.push("**Resized**");
    out.push(
      ...limited(
        diff.resized,
        maxItems,
        (b) =>
          `- \`${b.key}\`: ${fmtBox(b.before)} → ${fmtBox(b.after)}${b.followers ? ` (+${b.followers} descendants)` : ""}`,
      ),
    );
  }
  if (diff.moved.length) {
    out.push("**Moved**");
    out.push(
      ...limited(diff.moved, maxItems, (b) => {
        const dx = b.after[0] - b.before[0];
        const dy = b.after[1] - b.before[1];
        return `- \`${b.key}\`: Δ(${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy})px${b.followers ? ` (+${b.followers} descendants)` : ""}`;
      }),
    );
  }
  if (diff.visibilityChanged.length) {
    out.push("**Visibility**");
    out.push(
      ...limited(
        diff.visibilityChanged,
        maxItems,
        (v) =>
          `- \`${v.key}\`: ${v.before ? "visible" : "hidden"} → ${v.after ? "visible" : "hidden"}`,
      ),
    );
  }
  if (diff.appeared.length) {
    out.push("**Appeared**");
    out.push(...limited(diff.appeared, maxItems, (k) => `- \`${k}\``));
  }
  if (diff.disappeared.length) {
    out.push("**Disappeared**");
    out.push(...limited(diff.disappeared, maxItems, (k) => `- \`${k}\``));
  }
  if (diff.truncated)
    out.push(
      "_Note: snapshot was truncated (element cap); deep elements not compared._",
    );
  return out;
}

/**
 * Cross-shot overview: distinct root-variable changes and style change groups
 * with how many shots/elements they affect. Empty when nothing changed.
 */
export function renderOverview(diffs: SnapshotDiff[], maxItems = 15): string[] {
  const vars = new Map<string, { change: PropChange; shots: number }>();
  const styles = new Map<
    string,
    { changes: PropChange[]; shots: number; elements: number; example: string }
  >();
  let layoutShots = 0;
  for (const d of diffs) {
    for (const c of d.varChanges) {
      const sig = changeSig(c);
      const v = vars.get(sig) ?? { change: c, shots: 0 };
      v.shots += 1;
      vars.set(sig, v);
    }
    for (const g of groupStyleChanges(d.styleChanges)) {
      const sig = g.changes.map(changeSig).join("\u0001");
      const s = styles.get(sig) ?? {
        changes: g.changes,
        shots: 0,
        elements: 0,
        example: g.keys[0],
      };
      s.shots += 1;
      s.elements += g.keys.length;
      styles.set(sig, s);
    }
    if (
      d.moved.length ||
      d.resized.length ||
      d.appeared.length ||
      d.disappeared.length
    ) {
      layoutShots += 1;
    }
  }
  if (!vars.size && !styles.size && !layoutShots) return [];
  const out = ["## Overview", ""];
  if (vars.size) {
    out.push("Root custom properties:");
    out.push(
      ...limited(
        [...vars.values()],
        maxItems,
        (v) =>
          `- \`${v.change.prop}\`: \`${v.change.before}\` → \`${v.change.after}\` (${v.shots} shots)`,
      ),
    );
  }
  if (styles.size) {
    out.push("Computed style changes (all shots):");
    const ranked = [...styles.values()].sort(
      (a, b) => b.elements - a.elements || a.example.localeCompare(b.example),
    );
    out.push(
      ...limited(ranked, maxItems, (s) => {
        const what = s.changes
          .map((c) => `${c.prop}: \`${c.before}\` → \`${c.after}\``)
          .join("; ");
        return `- ${what} — ${s.elements} elements in ${s.shots} shots, e.g. \`${s.example}\``;
      }),
    );
  }
  if (layoutShots)
    out.push(
      `Layout (moved/resized/appeared/disappeared) changes in ${layoutShots} shots.`,
    );
  out.push("");
  return out;
}

export interface ReportInput {
  base: string;
  head: string;
  threshold: number;
  pixels: PixelResult[];
  diffs: SnapshotDiff[];
  summary: CompareSummary;
  notes?: string[];
}

export function renderMarkdownReport(input: ReportInput): string {
  const { summary } = input;
  const lines: string[] = [];
  lines.push(`# Visual compare: \`${input.base}\` → \`${input.head}\``);
  lines.push("");
  const changedShots = input.pixels.filter((p) => p.changedPixels > 0);
  lines.push(
    `**Result: ${summary.failed ? "FAIL" : "PASS"}** — ${changedShots.length}/${input.pixels.length} screenshots differ ` +
      `(${summary.pixelFailures.length} above threshold ${pct(input.threshold)}), ` +
      `${summary.styleFailures.length} shots with style/layout changes.`,
  );
  for (const note of input.notes ?? []) lines.push(`> ${note}`);
  if (summary.missingInHead.length)
    lines.push(`- Missing in head: ${summary.missingInHead.join(", ")}`);
  if (summary.missingInBase.length)
    lines.push(
      `- New in head (no baseline): ${summary.missingInBase.join(", ")}`,
    );
  lines.push("");
  lines.push(...renderOverview(input.diffs));
  lines.push("## Screenshots (ranked by % pixels changed)");
  lines.push("");
  lines.push("| shot | changed | pixels | size | changed regions (x,y w×h) |");
  lines.push("|---|---:|---:|---|---|");
  const ranked = [...input.pixels].sort(
    (a, b) => b.ratio - a.ratio || a.shot.localeCompare(b.shot),
  );
  for (const p of ranked) {
    const size =
      p.baseSize.join("×") === p.headSize.join("×")
        ? p.baseSize.join("×")
        : `${p.baseSize.join("×")} → ${p.headSize.join("×")}`;
    const regions = p.regions
      .slice(0, 4)
      .map((r) => `${r.x},${r.y} ${r.width}×${r.height}`)
      .join("; ");
    lines.push(
      `| ${p.shot} | ${pct(p.ratio)} | ${p.changedPixels} | ${size} | ${regions || "–"} |`,
    );
  }
  lines.push("");
  lines.push("## Style & layout changes");
  const withChanges = input.diffs.filter((d) => diffChangeCount(d) > 0);
  if (!withChanges.length) {
    lines.push("");
    lines.push("No computed-style or layout changes.");
  }
  // Identical change sets across shots (same page in other themes/viewports,
  // or a global change hitting every page) are printed once.
  const printed = new Map<string, string>();
  const varSigCounts = new Map<string, number>();
  for (const d of withChanges) {
    if (!d.varChanges.length) continue;
    const sig = varSig(d.varChanges);
    varSigCounts.set(sig, (varSigCounts.get(sig) ?? 0) + 1);
  }
  const commonVarSig = [...varSigCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const diff of withChanges) {
    const body = renderDiffBody(diff, 40, 6, commonVarSig);
    const text = body.join("\n");
    lines.push("");
    lines.push(`### ${diff.shot}`);
    const same = printed.get(text);
    if (same) {
      lines.push(`Same changes as ${same}.`);
      continue;
    }
    printed.set(text, diff.shot);
    lines.push(...body);
  }
  lines.push("");
  return lines.join("\n");
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

/** Side-by-side HTML report. Image paths are relative to the report dir. */
export function renderHtmlReport(
  input: ReportInput,
  images: Map<string, { base?: string; head?: string; diff?: string }>,
): string {
  const ranked = [...input.pixels].sort(
    (a, b) => b.ratio - a.ratio || a.shot.localeCompare(b.shot),
  );
  const rows = ranked
    .map((p) => {
      const img = images.get(p.shot) ?? {};
      const cell = (label: string, src?: string) =>
        `<figure><figcaption>${label}</figcaption>${src ? `<a href="${escapeHtml(src)}"><img loading="lazy" src="${escapeHtml(src)}"></a>` : "<p>missing</p>"}</figure>`;
      return `<section class="${p.changedPixels ? "changed" : "same"}"><h2>${escapeHtml(p.shot)} — ${pct(p.ratio)} (${p.changedPixels} px)</h2><div class="row">${cell("base", img.base)}${cell("head", img.head)}${cell("diff", img.diff)}</div></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual compare</title>
<style>
:root { --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #ddd; --bad: #c62828; }
@media (prefers-color-scheme: dark) { :root { --bg: #161618; --fg: #eee; --muted: #aaa; --line: #333; --bad: #ef5350; } }
body { background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; margin: 0 16px 40px; }
h1 { font-size: 20px; } h2 { font-size: 15px; margin: 24px 0 8px; }
.changed h2 { color: var(--bad); }
.row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: start; }
figure { margin: 0; border: 1px solid var(--line); }
figcaption { font-size: 12px; color: var(--muted); padding: 2px 6px; border-bottom: 1px solid var(--line); }
img { display: block; width: 100%; height: auto; }
pre { white-space: pre-wrap; border: 1px solid var(--line); padding: 8px; overflow-x: auto; }
label { display: block; margin: 8px 0; }
body.hide-same .same { display: none; }
@media (max-width: 700px) { .row { grid-template-columns: 1fr; } }
</style></head>
<body class="hide-same">
<h1>${escapeHtml(input.base)} → ${escapeHtml(input.head)}: ${input.summary.failed ? "FAIL" : "PASS"}</h1>
<label><input type="checkbox" onchange="document.body.classList.toggle('hide-same', !this.checked)"> show unchanged screenshots</label>
<details open><summary>Text report</summary><pre>${escapeHtml(renderMarkdownReport(input))}</pre></details>
${rows}
</body></html>
`;
}

// ---------------------------------------------------------------------------
// Changed regions
// ---------------------------------------------------------------------------

/**
 * Group changed tiles (row-major boolean mask) into bounding boxes of
 * 8-connected components, largest first.
 */
export function regionsFromTiles(
  mask: ArrayLike<number | boolean>,
  cols: number,
  rows: number,
  tile: number,
  limits?: { width: number; height: number; max?: number },
): Region[] {
  const seen = new Uint8Array(cols * rows);
  const regions: (Region & { tiles: number })[] = [];
  for (let start = 0; start < cols * rows; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let minX = cols;
    let minY = rows;
    let maxX = -1;
    let maxY = -1;
    let tiles = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % cols;
      const y = (i - x) / cols;
      tiles += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const x = minX * tile;
    const y = minY * tile;
    const w = (maxX + 1) * tile - x;
    const h = (maxY + 1) * tile - y;
    regions.push({
      x,
      y,
      width: limits ? Math.min(w, limits.width - x) : w,
      height: limits ? Math.min(h, limits.height - y) : h,
      tiles,
    });
  }
  regions.sort(
    (a, b) => b.width * b.height - a.width * a.height || a.y - b.y || a.x - b.x,
  );
  return regions.slice(0, limits?.max ?? 8).map(({ tiles: _tiles, ...r }) => r);
}
