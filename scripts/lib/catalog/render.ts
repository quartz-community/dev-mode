/**
 * Markdown renderers for the catalog: CATALOG.md, DATA-FLOW.md and per-package cards.
 */
import type {
  Catalog,
  DataKeyFlow,
  PackageEntry,
  Phase,
  PipelineStep,
} from "./types.js";

const cap = (xs: string[], n = 20): string => {
  if (xs.length === 0) return "—";
  const shown = xs.slice(0, n).join(", ");
  return xs.length > n ? `${shown}, … (+${xs.length - n})` : shown;
};
const code = (xs: string[]): string[] => xs.map((x) => `\`${x}\``);
const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Key → phases for one package and mode, e.g. `toc (markdownPlugins)`. */
export function keysWithPhases(
  p: PackageEntry,
  mode: "read" | "write",
  exclude: Set<string> = new Set(),
): string[] {
  const m = new Map<string, Set<Phase>>();
  for (const a of p.dataAccess) {
    if (a.mode !== mode || exclude.has(a.key)) continue;
    let s = m.get(a.key);
    if (!s) m.set(a.key, (s = new Set()));
    s.add(a.phase);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, ph]) => `\`${k}\` (${[...ph].join("/")})`);
}

export function componentsSummary(p: PackageEntry): string[] {
  return Object.entries(p.quartz?.components ?? {}).map(([name, c]) => {
    const pos = c.defaultPosition
      ? ` → ${c.defaultPosition}${c.defaultPriority !== undefined ? ` (prio ${c.defaultPriority})` : ""}`
      : "";
    return `${name}${pos}`;
  });
}

export function depsSummary(p: PackageEntry, includeDev = false): string[] {
  return p.workspaceDeps
    .filter((d) => includeDev || d.type !== "devDependencies")
    .map((d) =>
      d.type === "peerDependencies"
        ? `${d.dir} (peer)`
        : d.type === "devDependencies"
          ? `${d.dir} (dev)`
          : d.dir,
    );
}

export function renderCard(p: PackageEntry): string {
  const q = p.quartz;
  const lines: string[] = [];
  lines.push(`### ${p.dir}`);
  lines.push("");
  const head = [
    `**${p.npmName}**${p.version ? `@${p.version}` : ""}`,
    `kind: ${p.kind}`,
  ];
  if (q) {
    head.push(`category: ${q.category.join(", ") || "—"}`);
    head.push(`order: ${q.defaultOrder ?? 50}`);
    if (q.defaultEnabled !== undefined)
      head.push(
        q.defaultEnabled ? "enabled by default" : "disabled by default",
      );
  }
  lines.push(head.join(" · "));
  lines.push("");
  if (p.description) lines.push(`> ${p.description}`);
  if (p.readme && p.readme !== p.description)
    lines.push(`>\n> README: ${p.readme}`);
  if (p.description || p.readme) lines.push("");

  const row = (label: string, value: string) => {
    if (value && value !== "—") lines.push(`- **${label}:** ${value}`);
  };
  if (q) {
    row("Components", cap(componentsSummary(p)));
    row("Frames", cap(Object.keys(q.frames)));
    row("Options", cap(code(q.defaultOptionKeys), 30));
    if (q.dependencies.length) row("Quartz plugin deps", cap(q.dependencies));
    if (q.requires) row("Requires", "`" + JSON.stringify(q.requires) + "`");
    if (q.conflicts) row("Conflicts", "`" + JSON.stringify(q.conflicts) + "`");
    if (q.requiresInstall)
      row("Requires install", "`" + JSON.stringify(q.requiresInstall) + "`");
  }
  row("Hooks", cap(p.hooks, 30));
  row("Exports", cap(code(p.exports), 15));
  const writes = new Set(
    p.dataAccess.filter((a) => a.mode === "write").map((a) => a.key),
  );
  row("Writes data", cap(keysWithPhases(p, "write"), 30));
  const declaredOnly = p.dataMap.filter((d) => !writes.has(d.key));
  if (p.dir !== "types")
    row(
      "Declares (DataMap)",
      cap(
        p.dataMap.map(
          (d) =>
            `\`${d.key}${d.optional ? "?" : ""}: ${d.type.length > 60 ? d.type.slice(0, 57) + "..." : d.type}\``,
        ),
        15,
      ),
    );
  else
    row(
      "Declares canonical DataMap",
      cap(code(p.dataMap.map((d) => d.key)), 40),
    );
  if (declaredOnly.length && p.dir !== "types")
    row(
      "Declared but no direct write found",
      cap(code(declaredOnly.map((d) => d.key))),
    );
  row("Reads data", cap(keysWithPhases(p, "read", writes), 30));
  const fm = new Map<string, Set<string>>();
  for (const f of p.frontmatter)
    (fm.get(f.field) ?? fm.set(f.field, new Set()).get(f.field)!).add(
      f.mode === "write" ? "w" : "r",
    );
  row(
    "Frontmatter fields",
    cap(
      [...fm.entries()]
        .sort()
        .map(([k, m]) => `${k}${m.has("w") ? " (w)" : ""}`),
      30,
    ),
  );
  row("Emits files", cap(code([...new Set(p.emits.map((e) => e.path))]), 12));
  const c = p.client;
  if (c.scripts.length || c.listens.length || c.dispatches.length) {
    row("Client scripts", cap(code(c.scripts), 8));
    row(
      "Listens",
      cap(
        c.listens.map((x) => x.replace(/^document:/, "")),
        20,
      ),
    );
    row("Dispatches events", cap(c.dispatches));
    row("Uses addCleanup", c.usesAddCleanup ? "yes" : "no");
  }
  row("localStorage", cap(code(c.localStorage)));
  row("sessionStorage", cap(code(c.sessionStorage)));
  row("Fetches", cap(c.fetches));
  const d = p.dom;
  row(
    "Renders classes",
    cap(
      d.renderedClasses.map((x) => `.${x}`),
      25,
    ),
  );
  row(
    "Renders ids",
    cap(
      d.renderedIds.map((x) => `#${x}`),
      15,
    ),
  );
  row(
    "Styles classes",
    cap(
      d.styledClasses.map((x) => `.${x}`),
      25,
    ),
  );
  row(
    "Script queries",
    cap(
      [
        ...d.scriptedClasses.map((x) => `.${x}`),
        ...d.scriptedIds.map((x) => `#${x}`),
      ],
      25,
    ),
  );
  row("Stylesheets", cap(code(d.stylesheets), 8));
  row("Workspace deps", cap(depsSummary(p, true), 20));
  row("Dependents", cap(p.dependents, 25));
  lines.push(
    `- **Tests:** ${p.testFiles} file(s) · **Sources:** ${p.sourceFiles} file(s)`,
  );
  for (const w of p.warnings) lines.push(`- ⚠ ${w}`);
  lines.push("");
  return lines.join("\n");
}

export function renderCatalogMd(cat: Catalog): string {
  const out: string[] = [];
  out.push("# Quartz Workspace Plugin Catalog");
  out.push("");
  out.push(
    `Generated ${cat.generatedAt} by \`pnpm tsx scripts/catalog.ts build\` (${cat.packages.length} packages, ${cat.durationMs} ms). Static analysis — heuristic; verify against source before relying on it. See DATA-FLOW.md for the data-key graph and pipeline order.`,
  );
  out.push("");
  out.push(
    "Query instead of reading: `catalog show <pkg>`, `catalog who-writes <key>`, `catalog who-reads <key>`, `catalog dom <.class>`, `catalog impact <pkg>`, `catalog search <text>` (all accept `--json`).",
  );
  out.push("");
  const kinds = [
    "plugin",
    "core",
    "infrastructure",
    "theme",
    "tool",
    "unknown",
  ] as const;
  out.push("## Overview");
  out.push("");
  out.push(
    "| Package | Kind / category | Order | Hooks | Components → position | Provides (writes) | Consumes (reads) | Depends on |",
  );
  out.push("|---|---|---|---|---|---|---|---|");
  for (const kind of kinds) {
    for (const p of cat.packages.filter((x) => x.kind === kind)) {
      const katText = p.quartz?.category.length
        ? p.quartz.category.join(", ")
        : p.kind;
      const hooks = p.hooks.filter(
        (h) =>
          !["css", "priority", "layout", "fileExtensions", "frame"].includes(h),
      );
      out.push(
        `| ${p.dir}${p.npmName.split("/").pop() !== p.dir ? ` (${p.npmName})` : ""} | ${esc(katText)} | ${p.quartz?.defaultOrder ?? ""} | ${esc(cap(hooks, 8))} | ${esc(cap(componentsSummary(p), 4))} | ${esc(cap(code(p.provides), 8))} | ${esc(cap(code(p.consumes), 8))} | ${esc(cap(depsSummary(p), 6))} |`,
      );
    }
  }
  out.push("");
  const warned = cat.packages.filter((p) => p.warnings.length);
  if (warned.length) {
    out.push("## Warnings");
    out.push("");
    for (const p of warned)
      for (const w of p.warnings) out.push(`- **${p.dir}**: ${w}`);
    out.push("");
  }
  for (const kind of kinds) {
    const pkgs = cat.packages.filter((x) => x.kind === kind);
    if (!pkgs.length) continue;
    out.push(`## ${kind[0].toUpperCase()}${kind.slice(1)} packages`);
    out.push("");
    for (const p of pkgs) out.push(renderCard(p));
  }
  return out.join("\n");
}

const fmtActors = (xs: { pkg: string; phases: Phase[] }[]): string =>
  xs.length
    ? xs.map((x) => `${x.pkg} (${x.phases.join("/")})`).join(", ")
    : "—";

export function renderKeyFlow(f: DataKeyFlow): string {
  return `| \`${f.key}\` | ${f.type ? "`" + esc(f.type.length > 70 ? f.type.slice(0, 67) + "..." : f.type) + "`" : "—"} | ${esc(fmtActors(f.producers))} | ${esc(fmtActors(f.consumers))} | ${f.status === "ok" ? "" : f.status} |`;
}

function renderSteps(title: string, steps: PipelineStep[]): string[] {
  const out = [
    `### ${title}`,
    "",
    "| Order | Plugin | Phases | Writes | Reads |",
    "|---|---|---|---|---|",
  ];
  for (const s of steps) {
    const fmt = (r: Record<string, string[]>) =>
      Object.entries(r)
        .map(
          ([ph, keys]) => `${ph}: ${keys.map((k) => "`" + k + "`").join(", ")}`,
        )
        .join("; ") || "—";
    out.push(
      `| ${s.order} | ${s.pkg} | ${s.phases.join(", ") || "—"} | ${esc(fmt(s.writes))} | ${esc(fmt(s.reads))} |`,
    );
  }
  out.push("");
  return out;
}

export function renderDataFlowMd(cat: Catalog): string {
  const out: string[] = [];
  out.push("# Quartz vfile Data Flow");
  out.push("");
  out.push(
    `Generated ${cat.generatedAt}. Keys are \`file.data.<key>\` / \`fileData.<key>\` (vfile \`DataMap\`). Producers write the key; consumers read it. Phases: \`parse\` = Quartz core before any transformer; \`textTransform\` → \`markdownPlugins\` → \`htmlPlugins\` (transformer phases, each phase runs all transformers sorted by order); then filters (\`shouldPublish\`), page types / emitters (\`emit\`, \`generate\`, …) and \`component\` (render time). \`unknown\` = could not attribute the access to a hook. Client scripts (\`*.inline.ts\`) and Obsidian tools are excluded.`,
  );
  out.push("");
  out.push("## Keys");
  out.push("");
  out.push(
    "| Key | Declared type | Producers (phase) | Consumers (phase) | Flag |",
  );
  out.push("|---|---|---|---|---|");
  for (const f of cat.dataFlow) out.push(renderKeyFlow(f));
  out.push("");
  const never = cat.dataFlow.filter(
    (f) => f.status === "consumed-never-produced",
  );
  out.push("## Consumed but never produced");
  out.push("");
  out.push(
    "No workspace package writes these keys (no write found and no plugin `DataMap` declaration). Likely bugs, renamed keys, keys set by third-party plugins, or false positives of the analyser.",
  );
  out.push("");
  for (const f of never)
    out.push(
      `- \`${f.key}\`${f.declaredBy.length ? ` (declared in ${f.declaredBy.join(", ")})` : ""} — read by ${fmtActors(f.consumers)}`,
    );
  if (!never.length) out.push("- (none)");
  out.push("");
  const unused = cat.dataFlow.filter(
    (f) => f.status === "produced-never-consumed",
  );
  out.push("## Produced but never consumed");
  out.push("");
  out.push(
    "Written but never read in the workspace (may be part of a public contract for third-party plugins, or consumed via spread / dynamic access).",
  );
  out.push("");
  for (const f of unused)
    out.push(`- \`${f.key}\` — written by ${fmtActors(f.producers)}`);
  if (!unused.length) out.push("- (none)");
  out.push("");
  out.push("## Pipeline order");
  out.push("");
  out.push(
    "Quartz sorts each category by `order` (entry override, else `quartz.defaultOrder`, else 50; see `repos/quartz/quartz/plugins/loader/config-loader.ts`). Transformers are then applied phase by phase (`repos/quartz/quartz/processors/parse.ts`): all `textTransform`s, then every transformer's `markdownPlugins` in order, then every `htmlPlugins` in order. So a `markdownPlugins` write is visible to *every* `htmlPlugins` reader regardless of order. `(via X)` = access performed by an infrastructure remark/rehype package the plugin uses.",
  );
  out.push("");
  out.push(...renderSteps("Transformers", cat.pipeline.transformers));
  out.push("#### Phase-by-phase execution");
  out.push("");
  for (const phase of [
    "textTransform",
    "markdownPlugins",
    "htmlPlugins",
  ] as const) {
    const steps = cat.pipeline.transformers.filter((s) =>
      s.phases.includes(phase),
    );
    out.push(
      `${phase}: ${steps.map((s) => `${s.pkg}(${s.order})`).join(" → ") || "—"}`,
    );
    out.push("");
  }
  out.push(...renderSteps("Filters", cat.pipeline.filters));
  out.push(...renderSteps("Page types", cat.pipeline.pageTypes));
  out.push(...renderSteps("Emitters", cat.pipeline.emitters));
  out.push("## Keys with several transformer writers");
  out.push("");
  out.push(
    "Listed in execution order — the last writer wins unless it merges.",
  );
  out.push("");
  for (const m of cat.multiWriters)
    out.push(
      `- \`${m.key}\`: ${m.writers.map((w) => `${w.pkg} (${w.phase}, ${w.order})`).join(" → ")}`,
    );
  if (!cat.multiWriters.length) out.push("- (none)");
  out.push("");
  out.push("## Ordering hazards (default orders)");
  out.push("");
  out.push(
    "A transformer reads a key that, with default orders, is only written by a transformer that runs later (or at the same order, where the outcome depends on config order).",
  );
  out.push("");
  for (const h of cat.hazards) out.push(`- ${h.message}`);
  if (!cat.hazards.length) out.push("- (none detected)");
  out.push("");
  return out.join("\n");
}
