/**
 * Turns a RawTrace (written by the in-sandbox runtime) into an analyzed report
 * and a readable TRACE.md. Pure functions only.
 */
import type { ActorStats, PairCount, RawTrace } from "./recorder.js";

export type AnomalyKind =
  "read-before-write" | "multiple-writers" | "never-produced" | "virtual-only";

export interface Anomaly {
  kind: AnomalyKind;
  key: string;
  message: string;
  actors: string[];
  files?: number;
}

export interface KeyFlow {
  key: string;
  producers: Array<{ actor: string; writes: number }>;
  consumers: Array<{ actor: string; reads: number; misses: number }>;
}

export interface TraceReport {
  site: string;
  generatedAt: string;
  pipeline: Array<{ id: string; kind: string; calls: number; timeMs: number }>;
  plugins: Record<
    string,
    {
      kind: string;
      calls: number;
      files: number;
      timeMs: number;
      timePerFileMs: number | null;
      reads: Record<string, number>;
      misses: Record<string, number>;
      writes: Record<string, number>;
      enumerations: number;
      steps: ActorStats["steps"];
      emitted: number;
      emittedSample: string[];
      dropped: string[];
      errors: string[];
    }
  >;
  keys: KeyFlow[];
  slowest: Array<{ id: string; timeMs: number; note?: string }>;
  pageTypes: Record<string, number>;
  components: RawTrace["components"];
  anomalies: Anomaly[];
  warnings: string[];
}

/** Keys that are populated by vfile/unified itself rather than by plugins. */
const INTRINSIC_KEYS = new Set<string>([]);

const round = (n: number) => Math.round(n * 100) / 100;

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Strip the output-dir prefix shared by emitted paths ("public/foo.html" -> "foo.html"). */
export function relativizeEmitted(path: string, outputHint = "public"): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.indexOf(`/${outputHint}/`);
  if (idx >= 0) return norm.slice(idx + outputHint.length + 2);
  if (norm.startsWith(`${outputHint}/`))
    return norm.slice(outputHint.length + 1);
  return norm;
}

export function keyFlows(raw: RawTrace): KeyFlow[] {
  const flows = new Map<string, KeyFlow>();
  const flow = (key: string) => {
    let f = flows.get(key);
    if (!f) flows.set(key, (f = { key, producers: [], consumers: [] }));
    return f;
  };
  for (const [key, producers] of Object.entries(raw.seededKeys)) {
    for (const [actor, files] of Object.entries(producers))
      flow(key).producers.push({ actor, writes: files });
  }
  for (const a of raw.actors) {
    for (const [key, writes] of Object.entries(a.writes))
      flow(key).producers.push({ actor: a.id, writes });
    for (const [key, reads] of Object.entries(a.reads)) {
      flow(key).consumers.push({
        actor: a.id,
        reads,
        misses: a.misses[key] ?? 0,
      });
    }
  }
  return [...flows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function detectAnomalies(raw: RawTrace): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const flows = keyFlows(raw);

  // 1. Read before write: an actor looked for a key that a *later* actor produced on the same file.
  const rbw = [...raw.readBeforeWrite].sort(
    (a, b) => b.files - a.files || a.key.localeCompare(b.key),
  );
  for (const p of rbw) {
    anomalies.push({
      kind: "read-before-write",
      key: p.key,
      actors: [p.from, p.to],
      files: p.files,
      message: `\`${p.from}\` read \`${p.key}\` before \`${p.to}\` wrote it (${p.files} file(s)) — ordering dependency; the reader saw undefined`,
    });
  }

  // 2. Multiple writers: distinct plugin actors writing the same key (core seeds excluded).
  const overwrites = new Map<string, PairCount[]>();
  for (const o of raw.overwrites) {
    if (!overwrites.has(o.key)) overwrites.set(o.key, []);
    overwrites.get(o.key)!.push(o);
  }
  for (const f of flows) {
    const writers = [...new Set(f.producers.map((p) => p.actor))];
    const pluginWriters = writers.filter((w) => !w.startsWith("core"));
    const clobbers = (overwrites.get(f.key) ?? []).filter(
      (o) => !(o.from.startsWith("core") && o.to.startsWith("core")),
    );
    if (pluginWriters.length < 2 && clobbers.length === 0) continue;
    const detail = clobbers.length
      ? `; overwrites on the same file: ${clobbers.map((o) => `${o.from} → ${o.to} (${o.files} file(s))`).join(", ")}`
      : " (on disjoint files — no clobbering observed)";
    anomalies.push({
      kind: "multiple-writers",
      key: f.key,
      actors: writers,
      message: `\`${f.key}\` is written by ${writers.map((w) => `\`${w}\``).join(", ")}${detail}`,
    });
  }

  // 3. Never produced: read by someone, but no actor (nor core) ever wrote it and it was never present.
  for (const f of flows) {
    if (f.producers.length > 0 || INTRINSIC_KEYS.has(f.key)) continue;
    const readers = f.consumers.filter((c) => c.reads > 0);
    if (!readers.length) continue;
    anomalies.push({
      kind: "never-produced",
      key: f.key,
      actors: readers.map((r) => r.actor),
      message: `\`${f.key}\` is read by ${readers.map((r) => `\`${r.actor}\` (${r.reads}×)`).join(", ")} but no enabled plugin produces it`,
    });
  }
  // 4. Virtual-only: real pages read the key, but only core virtual-page seeding provides it
  //    (typically a transformer such as Description is not enabled).
  for (const f of flows) {
    if (
      !f.producers.length ||
      f.producers.some((p) => p.actor !== "core:virtual-page")
    )
      continue;
    const missing = f.consumers.filter((c) => c.misses > 0);
    if (!missing.length) continue;
    anomalies.push({
      kind: "virtual-only",
      key: f.key,
      actors: missing.map((c) => c.actor),
      message: `\`${f.key}\` is only set on virtual pages, yet ${missing.map((c) => `\`${c.actor}\` (${c.misses} miss(es))`).join(", ")} look for it on regular pages — is its producer plugin disabled?`,
    });
  }
  return anomalies;
}

export function analyzeTrace(raw: RawTrace, site: string): TraceReport {
  const plugins: TraceReport["plugins"] = {};
  for (const a of raw.actors) {
    plugins[a.id] = {
      kind: a.kind,
      calls: a.calls,
      files: a.files,
      timeMs: round(a.timeMs),
      timePerFileMs: a.files > 0 ? round(a.timeMs / a.files) : null,
      reads: sortedRecord(a.reads),
      misses: sortedRecord(a.misses),
      writes: sortedRecord(a.writes),
      enumerations: a.enumerations ?? 0,
      steps: Object.fromEntries(
        Object.entries(a.steps).map(([k, s]) => [
          k,
          { calls: s.calls, timeMs: round(s.timeMs) },
        ]),
      ),
      emitted: a.emitted.length,
      emittedSample: a.emitted
        .map((p) => relativizeEmitted(p))
        .sort()
        .slice(0, 50),
      dropped: a.dropped,
      errors: a.errors,
    };
  }
  const pipeline = raw.actors
    .filter(
      (a) => a.kind !== "component" && a.firstSeq !== Number.MAX_SAFE_INTEGER,
    )
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      calls: a.calls,
      timeMs: round(a.timeMs),
    }));
  const slowest = raw.actors
    .filter(
      (a) =>
        a.kind === "transformer" ||
        a.kind === "filter" ||
        a.kind === "emitter" ||
        a.kind === "pageType",
    )
    .sort((a, b) => b.timeMs - a.timeMs)
    .slice(0, 10)
    .map((a) => ({
      id: a.id,
      timeMs: round(a.timeMs),
      ...(a.kind === "emitter"
        ? { note: "wall time; emitters run concurrently" }
        : {}),
    }));
  return {
    site,
    generatedAt: raw.generatedAt,
    pipeline,
    plugins,
    keys: keyFlows(raw),
    slowest,
    pageTypes: Object.fromEntries(
      Object.entries(raw.pageTypes).map(([k, v]) => [k, v.length]),
    ),
    components: raw.components,
    anomalies: detectAnomalies(raw),
    warnings: raw.warnings,
  };
}

function topKeys(record: Record<string, number>, limit = 12): string {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "—";
  const shown = entries
    .slice(0, limit)
    .map(([k, n]) => `${k}(${n})`)
    .join(", ");
  return entries.length > limit
    ? `${shown}, +${entries.length - limit} more`
    : shown;
}

const esc = (s: string) => s.replace(/\|/g, "\\|");

export function renderMarkdown(report: TraceReport): string {
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);
  push(
    `# Runtime trace: ${report.site}`,
    "",
    `Generated ${report.generatedAt} by \`scripts/trace.ts\`. Counts are *runtime* accesses of top-level \`file.data\` keys`,
    "(nested writes such as `file.data.frontmatter.x = …` count as a read of `frontmatter`).",
    "",
  );
  if (report.warnings.length) {
    push("## Warnings", "", ...report.warnings.map((w) => `- ${w}`), "");
  }

  push("## Anomalies", "");
  if (!report.anomalies.length) push("None detected.");
  const labels: Record<AnomalyKind, string> = {
    "read-before-write": "Read before write",
    "multiple-writers": "Key written by more than one actor",
    "never-produced": "Read but never produced",
    "virtual-only": "Only produced for virtual pages",
  };
  for (const kind of Object.keys(labels) as AnomalyKind[]) {
    const items = report.anomalies.filter((a) => a.kind === kind);
    if (!items.length) continue;
    push(
      `### ${labels[kind]} (${items.length})`,
      "",
      ...items.map((a) => `- ${a.message}`),
      "",
    );
  }
  push("");

  push(
    "## Pipeline (execution order)",
    "",
    "| # | Actor | Kind | Calls | Time (ms) |",
    "|---|---|---|---|---|",
  );
  report.pipeline.forEach((p, i) =>
    push(`| ${i + 1} | \`${p.id}\` | ${p.kind} | ${p.calls} | ${p.timeMs} |`),
  );
  push("");

  push("## Slowest", "", "| Actor | Time (ms) | Note |", "|---|---|---|");
  for (const s of report.slowest)
    push(`| \`${s.id}\` | ${s.timeMs} | ${s.note ?? ""} |`);
  push("");

  push(
    "## Per-plugin data access",
    "",
    "| Actor | Files | ms/file | Writes | Reads | Misses (key absent) | Enumerations |",
    "|---|---|---|---|---|---|---|",
  );
  for (const [id, p] of Object.entries(report.plugins)) {
    if (p.kind === "component") continue;
    push(
      `| \`${id}\` | ${p.files || "—"} | ${p.timePerFileMs ?? "—"} | ${esc(topKeys(p.writes))} | ${esc(topKeys(p.reads))} | ${esc(topKeys(p.misses, 6))} | ${p.enumerations || ""} |`,
    );
  }
  push("");

  const components = Object.entries(report.plugins).filter(
    ([, p]) => p.kind === "component",
  );
  if (components.length) {
    push(
      "## Component data access",
      "",
      "| Component | Reads | Misses | Enumerations |",
      "|---|---|---|---|",
    );
    for (const [id, p] of components) {
      push(
        `| \`${id}\` | ${esc(topKeys(p.reads, 8))} | ${esc(topKeys(p.misses, 5))} | ${p.enumerations || ""} |`,
      );
    }
    push("");
  }

  push(
    "## Key flow (producers → consumers)",
    "",
    "| Key | Producers | Consumers |",
    "|---|---|---|",
  );
  for (const f of report.keys) {
    const producers =
      f.producers.map((p) => `${p.actor}`).join(", ") || "**none**";
    const consumers =
      f.consumers.map((c) => `${c.actor}(${c.reads})`).join(", ") || "*unread*";
    push(`| \`${f.key}\` | ${esc(producers)} | ${esc(consumers)} |`);
  }
  push("");

  push(
    "## Emitter outputs",
    "",
    "| Emitter | Files | Sample |",
    "|---|---|---|",
  );
  for (const [id, p] of Object.entries(report.plugins)) {
    if (p.kind !== "emitter") continue;
    push(
      `| \`${id}\` | ${p.emitted} | ${esc(p.emittedSample.slice(0, 5).join(", ")) || "—"} |`,
    );
  }
  push("");

  push("## Components per page type", "");
  for (const [pt, comps] of Object.entries(report.components).sort()) {
    const pages = report.pageTypes[pt] ?? 0;
    const list = Object.entries(comps)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([c, n]) => `${c}(${n})`)
      .join(", ");
    push(`- **${pt}** (${pages} page(s)): ${list}`);
  }
  push("");

  const filters = Object.entries(report.plugins).filter(
    ([, p]) => p.kind === "filter",
  );
  if (filters.length) {
    push("## Filters", "");
    for (const [id, p] of filters)
      push(
        `- \`${id}\` dropped ${p.dropped.length}: ${p.dropped.join(", ") || "—"}`,
      );
    push("");
  }

  const errors = Object.entries(report.plugins).filter(
    ([, p]) => p.errors.length,
  );
  if (errors.length) {
    push("## Errors", "");
    for (const [id, p] of errors) push(`- \`${id}\`: ${p.errors.join("; ")}`);
    push("");
  }
  return lines.join("\n");
}
