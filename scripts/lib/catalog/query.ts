/**
 * Query helpers over a built catalog: lookup, who-writes / who-reads, impact,
 * DOM ownership and fuzzy search.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeReadJson } from "../json.js";
import { buildCatalog, newestInputMtime } from "./build.js";
import { selectorTokens } from "./source-analysis.js";
import type { Catalog, PackageEntry, Phase } from "./types.js";

export const CATALOG_SUBDIR = "catalog";

/** Use `.dev/catalog/catalog.json` when it is newer than every analysed input, else rebuild in memory. */
export function loadCatalog(
  workspaceRoot: string,
  devDir: string,
): { catalog: Catalog; cached: boolean } {
  const jsonPath = join(devDir, CATALOG_SUBDIR, "catalog.json");
  if (existsSync(jsonPath)) {
    const mtime = statSync(jsonPath).mtimeMs;
    if (mtime >= newestInputMtime(workspaceRoot)) {
      return { catalog: safeReadJson<Catalog>(jsonPath), cached: true };
    }
  }
  return { catalog: buildCatalog({ workspaceRoot }), cached: false };
}

const norm = (s: string): string => s.toLowerCase().replace(/^@[^/]+\//, "");

export function findPackage(
  cat: Catalog,
  query: string,
): PackageEntry | undefined {
  const q = query.toLowerCase();
  const exact = cat.packages.find(
    (p) =>
      p.dir === q ||
      p.npmName.toLowerCase() === q ||
      norm(p.npmName) === norm(q) ||
      p.quartz?.name?.toLowerCase() === q,
  );
  if (exact) return exact;
  const byDisplay = cat.packages.find(
    (p) =>
      p.quartz?.displayName?.toLowerCase() === q ||
      Object.keys(p.quartz?.components ?? {}).some(
        (c) => c.toLowerCase() === q,
      ) ||
      p.exports.some((e) => e.toLowerCase() === q),
  );
  return byDisplay;
}

export function suggestPackages(cat: Catalog, query: string): string[] {
  return search(cat, query)
    .slice(0, 5)
    .map((r) => r.pkg);
}

export interface KeyHit {
  pkg: string;
  kind: string;
  phases: Phase[];
  locations: string[];
  declared?: string;
}

export function whoAccesses(
  cat: Catalog,
  key: string,
  mode: "read" | "write",
): KeyHit[] {
  const out: KeyHit[] = [];
  for (const p of cat.packages) {
    const hits = p.dataAccess.filter((a) => a.key === key && a.mode === mode);
    const decl = p.dataMap.find((d) => d.key === key);
    if (!hits.length && !(mode === "write" && decl && p.dir !== "types"))
      continue;
    out.push({
      pkg: p.dir,
      kind: p.kind,
      phases: [...new Set(hits.map((h) => h.phase))],
      locations: [
        ...new Set(hits.map((h) => `repos/${p.dir}/${h.file}:${h.line}`)),
      ],
      declared: decl
        ? `${decl.key}${decl.optional ? "?" : ""}: ${decl.type}`
        : undefined,
    });
  }
  return out;
}

export interface ImpactResult {
  pkg: string;
  npmName: string;
  kind: string;
  directDependents: string[];
  transitiveDependents: string[];
  fixtures: { name: string; kind: string; via: string[] }[];
  specs: { file: string; reasons: string[] }[];
  dataKeysProvided: { key: string; consumers: string[] }[];
  commands: string[];
}

function filterName(p: PackageEntry): string {
  return p.npmName;
}

export function impact(
  cat: Catalog,
  pkg: PackageEntry,
  workspaceRoot: string,
): ImpactResult {
  const byDir = new Map(cat.packages.map((p) => [p.dir, p]));
  const seen = new Set<string>();
  const queue = [...pkg.dependents];
  while (queue.length) {
    const d = queue.shift()!;
    if (seen.has(d) || d === pkg.dir) continue;
    seen.add(d);
    const dep = byDir.get(d);
    // Core is the final consumer: plugins that peer-depend on core are not affected by a plugin change.
    if (dep && dep.kind === "core" && pkg.kind !== "core") continue;
    queue.push(...(dep?.dependents ?? []));
  }
  const affected = new Set([pkg.dir, ...seen]);
  const everything =
    pkg.kind === "core" ||
    pkg.dir === "types" ||
    pkg.dir === "utils" ||
    pkg.dir === "runtime";

  const fixtures = cat.fixtures
    .map((f) => ({
      name: f.name,
      kind: f.kind,
      via: everything ? [pkg.dir] : f.plugins.filter((x) => affected.has(x)),
    }))
    .filter((f) => f.via.length > 0);
  const fixtureNames = new Set(fixtures.map((f) => f.name));

  // classes unique to this package (avoid matching shared names such as `.internal`)
  const owners = new Map<string, Set<string>>();
  for (const p of cat.packages) {
    for (const c of [...p.dom.renderedClasses, ...p.dom.styledClasses]) {
      (owners.get(c) ?? owners.set(c, new Set()).get(c)!).add(p.dir);
    }
  }
  const uniqueClasses = [
    ...new Set([...pkg.dom.renderedClasses, ...pkg.dom.styledClasses]),
  ].filter((c) => c.length >= 4 && owners.get(c)?.size === 1);
  const needles = [
    pkg.dir,
    pkg.npmName,
    ...Object.keys(pkg.quartz?.components ?? {}),
  ].filter((n) => n.length >= 4);

  const specs: ImpactResult["specs"] = [];
  for (const s of cat.specs) {
    const reasons: string[] = [];
    const fx = s.fixtures.filter((f) => fixtureNames.has(f));
    if (fx.length) reasons.push(`uses fixture ${fx.join(", ")}`);
    let text = "";
    try {
      text = readFileSync(join(workspaceRoot, s.file), "utf-8");
    } catch {
      /* spec removed since build */
    }
    const mentioned = needles.filter((n) => text.includes(n));
    if (mentioned.length) reasons.push(`mentions ${mentioned.join(", ")}`);
    const cls = uniqueClasses.filter((c) =>
      new RegExp(`\\.${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(text),
    );
    if (cls.length)
      reasons.push(
        `selects ${cls
          .slice(0, 6)
          .map((c) => "." + c)
          .join(", ")}`,
      );
    if (reasons.length) specs.push({ file: s.file, reasons });
  }

  const provided = pkg.provides.map((key) => ({
    key,
    consumers: [
      ...new Set(
        cat.packages
          .filter((p) => p.dir !== pkg.dir && p.consumes.includes(key))
          .map((p) => p.dir),
      ),
    ],
  }));

  const commands: string[] = [];
  const isCommunity = pkg.npmName.startsWith("@quartz-community/");
  const suffix = pkg.npmName.split("/").pop()!;
  if (isCommunity) {
    commands.push(`just build-plugin ${suffix}`);
    if (pkg.testFiles > 0) commands.push(`just test-plugin ${suffix}`);
  } else {
    commands.push(`pnpm turbo run build --filter=${filterName(pkg)}`);
    if (pkg.testFiles > 0)
      commands.push(`pnpm turbo run test --filter=${filterName(pkg)}`);
  }
  if (seen.size > 0)
    commands.push(
      `pnpm turbo run build test --filter=...${filterName(pkg)}   # ${seen.size} dependent(s)`,
    );
  if (
    pkg.kind === "infrastructure" ||
    pkg.kind === "core" ||
    seen.size > 3 ||
    pkg.dataMap.length > 0
  )
    commands.push("just typecheck");
  else commands.push(`pnpm turbo run typecheck --filter=${filterName(pkg)}`);
  const consumersOfData = provided.some((p) => p.consumers.length > 0);
  if (consumersOfData) {
    const cs = [...new Set(provided.flatMap((p) => p.consumers))].filter(
      (c) => byDir.get(c)?.testFiles,
    );
    for (const c of cs.slice(0, 6)) {
      const cp = byDir.get(c)!;
      if (cp.npmName.startsWith("@quartz-community/"))
        commands.push(
          `just test-plugin ${cp.npmName.split("/").pop()}   # consumes data from ${pkg.dir}`,
        );
    }
  }
  for (const f of fixtures) {
    if (f.kind === "fixture") commands.push(`just e2e-build ${f.name}`);
  }
  if (specs.length) {
    commands.push(
      `pnpm exec playwright test --config e2e/playwright.config.ts ${specs.map((s) => s.file.split("/").pop()!.replace(/\.ts$/, "")).join(" ")}`,
    );
  } else if (fixtures.length) {
    commands.push("just e2e-test");
  }
  if (pkg.kind === "plugin" && pkg.quartz)
    commands.push("just serve   # manual check in the docs site");

  return {
    pkg: pkg.dir,
    npmName: pkg.npmName,
    kind: pkg.kind,
    directDependents: pkg.dependents,
    transitiveDependents: [...seen].sort(),
    fixtures,
    specs,
    dataKeysProvided: provided,
    commands,
  };
}

export interface DomHit {
  pkg: string;
  token: string;
  roles: ("renders" | "styles" | "scripts")[];
  exact: boolean;
}

export function domLookup(cat: Catalog, query: string): DomHit[] {
  const parsed = selectorTokens(query);
  const tokens: { kind: "class" | "id" | "any"; name: string }[] = [
    ...parsed.classes.map((name) => ({ kind: "class" as const, name })),
    ...parsed.ids.map((name) => ({ kind: "id" as const, name })),
  ];
  if (!tokens.length) tokens.push({ kind: "any", name: query.trim() });
  const out: DomHit[] = [];
  const check = (exact: boolean) => {
    for (const t of tokens) {
      const match = (xs: string[]) =>
        exact
          ? xs.some(
              (x) =>
                x === t.name ||
                (x.endsWith("*") && t.name.startsWith(x.slice(0, -1))),
            )
          : xs.some((x) => x.includes(t.name));
      for (const p of cat.packages) {
        const roles: DomHit["roles"] = [];
        const cls = t.kind !== "id";
        const ids = t.kind !== "class";
        if (
          (cls && match(p.dom.renderedClasses)) ||
          (ids && match(p.dom.renderedIds))
        )
          roles.push("renders");
        if (
          (cls && match(p.dom.styledClasses)) ||
          (ids && match(p.dom.styledIds))
        )
          roles.push("styles");
        if (
          (cls && match(p.dom.scriptedClasses)) ||
          (ids && match(p.dom.scriptedIds))
        )
          roles.push("scripts");
        if (roles.length)
          out.push({
            pkg: p.dir,
            token:
              (t.kind === "id" ? "#" : t.kind === "class" ? "." : "") + t.name,
            roles,
            exact,
          });
      }
    }
  };
  check(true);
  if (!out.length) check(false);
  // renderers first
  return out.sort(
    (a, b) =>
      Number(b.roles.includes("renders")) -
        Number(a.roles.includes("renders")) || b.roles.length - a.roles.length,
  );
}

export interface SearchHit {
  pkg: string;
  score: number;
  matches: string[];
}

function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

export function search(cat: Catalog, text: string): SearchHit[] {
  const q = text.toLowerCase().trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const p of cat.packages) {
    let score = 0;
    const matches: string[] = [];
    const field = (
      label: string,
      values: (string | undefined)[],
      weight: number,
    ) => {
      for (const v of values) {
        if (!v) continue;
        const l = v.toLowerCase();
        if (l === q) {
          score += weight * 3;
          matches.push(`${label}: ${v}`);
        } else if (l.includes(q)) {
          score += weight;
          matches.push(
            `${label}: ${v.length > 80 ? v.slice(0, 77) + "..." : v}`,
          );
        }
      }
    };
    field("name", [p.dir, p.npmName, p.quartz?.displayName], 10);
    field("component", Object.keys(p.quartz?.components ?? {}), 6);
    field("export", p.exports, 4);
    field("provides", p.provides, 5);
    field("consumes", p.consumes, 2);
    field("frontmatter", [...new Set(p.frontmatter.map((f) => f.field))], 2);
    field(
      "class",
      [...new Set([...p.dom.renderedClasses, ...p.dom.styledClasses])],
      3,
    );
    field("event", [...p.client.listens, ...p.client.dispatches], 3);
    field("storage", [...p.client.localStorage, ...p.client.sessionStorage], 3);
    field("fetches", p.client.fetches, 3);
    field(
      "emits",
      p.emits.map((e) => e.path),
      3,
    );
    field("option", p.quartz?.defaultOptionKeys ?? [], 2);
    field("hook", p.hooks, 1);
    field("description", [p.description, p.readme], 2);
    if (!score && q.length >= 3 && subsequence(q, p.dir)) {
      score = 1;
      matches.push(`fuzzy: ${p.dir}`);
    }
    if (score)
      hits.push({
        pkg: p.dir,
        score,
        matches: [...new Set(matches)].slice(0, 6),
      });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.pkg.localeCompare(b.pkg))
    .slice(0, 15);
}
