import type {
  CoverageAnalysis,
  FunctionResult,
  PluginSummary,
} from "./analyze.js";

export interface RenderOptions {
  /** Max never-executed functions listed per script (0 = all). */
  limit: number;
  generatedAt: string;
  warnings: string[];
}

function pct(n: number, d: number): string {
  return d === 0 ? "–" : `${Math.round((1000 * n) / d) / 10}%`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/`/g, "'");
}

function fnLine(f: FunctionResult): string {
  const parts = [`\`${escapeCell(f.name)}\``];
  if (f.location) parts.push(f.location);
  if (f.context && f.context !== f.name)
    parts.push(`(${escapeCell(f.context)})`);
  let line = `- ${parts.join(" — ")}`;
  if (f.snippet && !f.snippet.startsWith(f.name))
    line += `  \n  \`${escapeCell(f.snippet)}\``;
  return line;
}

export function renderMarkdown(
  analysis: CoverageAnalysis,
  summaries: PluginSummary[],
  options: RenderOptions,
): string {
  const lines: string[] = [];
  lines.push("# E2E browser-script coverage");
  lines.push("");
  lines.push(
    `Generated ${options.generatedAt} from ${analysis.dumps} test dumps (\`E2E_JS_COVERAGE\`). ` +
      "Per plugin: share of its own browser-script functions (`*.inline.ts` + local imports; " +
      "bundled dependencies such as utils counted separately) whose body ran in at least one test. " +
      "Regenerate with `just e2e-coverage`; `--report-only` re-renders existing dumps.",
  );
  lines.push("");
  lines.push(
    "| Plugin | Scripts | Loaded | Own functions run | % | Bundled-dep functions run | Notes |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  const byPlugin = new Map<string, typeof analysis.literals>();
  for (const r of analysis.literals) {
    const list = byPlugin.get(r.literal.plugin) ?? [];
    list.push(r);
    byPlugin.set(r.literal.plugin, list);
  }
  for (const s of summaries) {
    const list = byPlugin.get(s.plugin) ?? [];
    const notes = [
      ...new Set(list.map((r) => r.literal.note).filter(Boolean) as string[]),
    ];
    const loaded = s.scripts - s.neverLoaded.length;
    lines.push(
      `| ${s.plugin} | ${s.scripts} | ${loaded}/${s.scripts} | ${s.ownExecuted}/${s.ownFunctions} | ${
        s.percent === null ? "–" : `${s.percent}%`
      } | ${s.allExecuted - s.ownExecuted}/${s.allFunctions - s.ownFunctions} | ${escapeCell(notes.join("; "))} |`,
    );
  }
  lines.push("");

  const never = summaries.flatMap((s) => s.neverLoaded);
  if (never.length) {
    lines.push("## Browser scripts no test loads");
    lines.push("");
    for (const f of never) lines.push(`- ${f}`);
    lines.push("");
  }

  lines.push("## Never-executed functions, by plugin");
  lines.push("");
  lines.push(
    "Least-covered plugins first. Names come from the plugin's source map (rebuilt from `src/`); " +
      "`(context)` is the call or assignment the function is passed to in the built code.",
  );
  lines.push("");
  for (const s of summaries) {
    const list = byPlugin.get(s.plugin) ?? [];
    lines.push(
      `### ${s.plugin} — ${s.percent === null ? "–" : `${s.percent}%`} (${s.ownExecuted}/${s.ownFunctions})`,
    );
    lines.push("");
    for (const r of list) {
      const own = r.functions.filter((f) => f.own);
      const missed = own.filter((f) => !f.executed);
      const bundled = r.functions.filter((f) => !f.own);
      lines.push(
        `**${r.literal.file}** — loaded by ${r.tests} test(s); own ${own.length - missed.length}/${own.length} run` +
          (bundled.length
            ? `, bundled ${bundled.filter((f) => f.executed).length}/${bundled.length}`
            : ""),
      );
      lines.push("");
      if (r.tests === 0) {
        lines.push("_No test page loads this script._");
        lines.push("");
        continue;
      }
      const shown = options.limit > 0 ? missed.slice(0, options.limit) : missed;
      for (const f of shown) lines.push(fnLine(f));
      if (shown.length < missed.length)
        lines.push(`- … ${missed.length - shown.length} more (\`--all\`)`);
      if (missed.length === 0) lines.push("_All own functions executed._");
      lines.push("");
    }
  }

  if (analysis.unattributed.length) {
    lines.push("## Served scripts not attributed to a plugin script");
    lines.push("");
    lines.push(
      "Local scripts matching no rebuilt `*.inline.ts` (raw `afterDOMLoaded` strings, Quartz's inline config, vendored libraries). Owner is a guess from the dist text containing most of their lines.",
    );
    lines.push("");
    lines.push("| Script | Owner (guess) | Bytes | Tests | Functions run |");
    lines.push("| --- | --- | --- | --- | --- |");
    // Orchestrators such as postscript.js (only `import()` calls) have no functions.
    const rows = analysis.unattributed
      .filter((u) => u.functions.length > 0)
      .sort((a, b) => (a.owner ?? "~").localeCompare(b.owner ?? "~"));
    for (const u of rows) {
      let path = u.url;
      try {
        path = new URL(u.url).pathname;
      } catch {
        // keep url
      }
      const run = u.functions.filter((f) => f.executed).length;
      lines.push(
        `| ${escapeCell(path)} | ${u.owner ?? "?"} | ${u.bytes} | ${u.tests} | ${run}/${u.functions.length} (${pct(run, u.functions.length)}) |`,
      );
    }
    lines.push("");
  }

  lines.push("## Limitations");
  lines.push("");
  lines.push(
    "- Function-level only: a function counts as run when its body started once; branches inside it are not measured.",
  );
  lines.push(
    "- Scripts are matched by exact text: a site built from an older `dist/` than the current one is reported as unattributed. `just e2e-coverage` rebuilds everything first.",
  );
  lines.push(
    "- Only Chromium, only pages opened through the `page` fixture, only scripts served from 127.0.0.1/localhost.",
  );
  if (options.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of options.warnings) lines.push(`- ${escapeCell(w)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function toJson(
  analysis: CoverageAnalysis,
  summaries: PluginSummary[],
  warnings: string[],
) {
  return {
    dumps: analysis.dumps,
    plugins: summaries,
    scripts: analysis.literals.map((r) => ({
      id: r.literal.id,
      plugin: r.literal.plugin,
      file: r.literal.file,
      kind: r.literal.kind,
      note: r.literal.note,
      tests: r.tests,
      functions: r.functions.map((f) => ({
        name: f.name,
        location: f.location,
        context: f.context,
        own: f.own,
        executed: f.executed,
      })),
    })),
    unattributed: analysis.unattributed.map((u) => ({
      url: u.url,
      owner: u.owner,
      bytes: u.bytes,
      tests: u.tests,
      functions: u.functions.length,
      executed: u.functions.filter((f) => f.executed).length,
    })),
    warnings,
  };
}
