/**
 * Plugin catalog / atlas for the Quartz workspace.
 *
 *   pnpm tsx scripts/catalog.ts [build]            write .dev/catalog/{catalog.json,CATALOG.md,DATA-FLOW.md}
 *   pnpm tsx scripts/catalog.ts show <pkg>         print one package card
 *   pnpm tsx scripts/catalog.ts who-writes <key>   producers of file.data.<key>
 *   pnpm tsx scripts/catalog.ts who-reads <key>    consumers of file.data.<key>
 *   pnpm tsx scripts/catalog.ts impact <pkg>       dependents, e2e fixtures/specs, verification commands
 *   pnpm tsx scripts/catalog.ts dom <selector>     which packages render / style / script a class or id
 *   pnpm tsx scripts/catalog.ts search <text>      fuzzy search over names, keys, classes, events…
 *
 * Every subcommand accepts --json. Query subcommands reuse catalog.json when it
 * is newer than all analysed sources, otherwise they rebuild in memory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "./lib/args.js";
import { buildCatalog } from "./lib/catalog/build.js";
import {
  CATALOG_SUBDIR,
  domLookup,
  findPackage,
  impact,
  loadCatalog,
  search,
  suggestPackages,
  whoAccesses,
} from "./lib/catalog/query.js";
import {
  renderCard,
  renderCatalogMd,
  renderDataFlowMd,
} from "./lib/catalog/render.js";
import type { Catalog } from "./lib/catalog/types.js";
import { DEV_DIR, WORKSPACE_ROOT } from "./lib/sandbox.js";

const USAGE = `Usage: catalog <command> [args] [--json]

Commands:
  build                 (default) analyse repos/ and write .dev/catalog/
  show <pkg>            one package card (dir, npm name, component or display name)
  who-writes <key>      packages that write file.data.<key>
  who-reads <key>       packages that read file.data.<key>
  impact <pkg>          transitive dependents, e2e fixtures/specs, verification commands
  dom <selector>        packages that render / style / script a class or id (".foo", "#bar", "foo")
  search <text>         fuzzy search across the catalog`;

function fail(message: string, asJson: boolean): never {
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(message);
  process.exit(1);
}

function writeOutputs(cat: Catalog): string {
  const outDir = join(DEV_DIR, CATALOG_SUBDIR);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "catalog.json"),
    JSON.stringify(cat, null, 2) + "\n",
  );
  writeFileSync(join(outDir, "CATALOG.md"), renderCatalogMd(cat));
  writeFileSync(join(outDir, "DATA-FLOW.md"), renderDataFlowMd(cat));
  return outDir;
}

function requirePackage(
  cat: Catalog,
  name: string | undefined,
  asJson: boolean,
) {
  if (!name) fail("Missing package name.\n\n" + USAGE, asJson);
  const pkg = findPackage(cat, name);
  if (!pkg) {
    const s = suggestPackages(cat, name);
    fail(
      `Unknown package "${name}".${s.length ? ` Did you mean: ${s.join(", ")}?` : ""}`,
      asJson,
    );
  }
  return pkg;
}

function main(): void {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const asJson = flags.json === true;
  const [command = "build", ...rest] = positional;
  const arg = rest.join(" ");

  if (flags.help || command === "help") {
    console.log(USAGE);
    return;
  }

  if (command === "build") {
    const cat = buildCatalog({ workspaceRoot: WORKSPACE_ROOT });
    const outDir = writeOutputs(cat);
    const counts: Record<string, number> = {};
    for (const p of cat.packages) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    const flagged = cat.dataFlow
      .filter((f) => f.status === "consumed-never-produced")
      .map((f) => f.key);
    const summary = {
      ok: true,
      outDir: relative(WORKSPACE_ROOT, outDir),
      durationMs: cat.durationMs,
      packages: counts,
      dataKeys: cat.dataFlow.length,
      consumedNeverProduced: flagged,
      producedNeverConsumed: cat.dataFlow.filter(
        (f) => f.status === "produced-never-consumed",
      ).length,
      orderingHazards: cat.hazards.length,
    };
    if (asJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `Catalog: ${cat.packages.length} packages (${Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ")}) in ${cat.durationMs} ms`,
      );
      console.log(
        `Data keys: ${cat.dataFlow.length} · consumed-never-produced: ${flagged.join(", ") || "none"} · produced-never-consumed: ${summary.producedNeverConsumed} · ordering hazards: ${cat.hazards.length}`,
      );
      console.log(
        `Wrote ${summary.outDir}/{catalog.json,CATALOG.md,DATA-FLOW.md}`,
      );
    }
    return;
  }

  const { catalog: cat } = loadCatalog(WORKSPACE_ROOT, DEV_DIR);

  switch (command) {
    case "show": {
      const pkg = requirePackage(cat, arg, asJson);
      console.log(asJson ? JSON.stringify(pkg, null, 2) : renderCard(pkg));
      return;
    }
    case "who-writes":
    case "who-reads": {
      if (!arg) fail("Missing data key.\n\n" + USAGE, asJson);
      const mode = command === "who-writes" ? "write" : "read";
      const hits = whoAccesses(cat, arg, mode);
      const flow = cat.dataFlow.find((f) => f.key === arg);
      if (asJson) {
        console.log(
          JSON.stringify(
            { key: arg, type: flow?.type, status: flow?.status, hits },
            null,
            2,
          ),
        );
        return;
      }
      if (!hits.length) {
        const similar = cat.dataFlow
          .filter((f) => f.key.toLowerCase().includes(arg.toLowerCase()))
          .map((f) => f.key);
        console.log(
          `No package ${mode}s \`${arg}\`.${similar.length ? ` Similar keys: ${similar.join(", ")}` : ""}`,
        );
        return;
      }
      console.log(
        `\`${arg}\`${flow?.type ? `: ${flow.type}` : ""}${flow && flow.status !== "ok" ? `  [${flow.status}]` : ""}`,
      );
      for (const h of hits) {
        console.log(
          `- ${h.pkg} (${h.kind}) — ${h.phases.join(", ") || "declared in DataMap"}`,
        );
        for (const l of h.locations.slice(0, 8)) console.log(`    ${l}`);
        if (h.locations.length > 8)
          console.log(`    … +${h.locations.length - 8} more`);
        if (h.declared && mode === "write")
          console.log(`    DataMap: ${h.declared}`);
      }
      return;
    }
    case "impact": {
      const pkg = requirePackage(cat, arg, asJson);
      const r = impact(cat, pkg, WORKSPACE_ROOT);
      if (asJson) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      console.log(`Impact of ${r.pkg} (${r.npmName}, ${r.kind})`);
      console.log(
        `- Direct dependents: ${r.directDependents.join(", ") || "none"}`,
      );
      console.log(
        `- Transitive dependents (${r.transitiveDependents.length}): ${r.transitiveDependents.join(", ") || "none"}`,
      );
      const dk = r.dataKeysProvided.filter((d) => d.consumers.length);
      if (dk.length)
        console.log(
          `- Data consumers: ${dk.map((d) => `${d.key} → ${d.consumers.join(", ")}`).join("; ")}`,
        );
      console.log(
        `- E2E fixtures/repros: ${r.fixtures.map((f) => `${f.name}${f.kind === "repro" ? " (repro)" : ""} [via ${f.via.join(", ")}]`).join(", ") || "none"}`,
      );
      console.log(`- E2E specs: ${r.specs.length ? "" : "none"}`);
      for (const s of r.specs)
        console.log(`    ${s.file} — ${s.reasons.join("; ")}`);
      console.log("\nSuggested verification:");
      for (const c of r.commands) console.log(`  ${c}`);
      return;
    }
    case "dom": {
      if (!arg) fail("Missing class or selector.\n\n" + USAGE, asJson);
      const hits = domLookup(cat, arg);
      if (asJson) {
        console.log(JSON.stringify({ query: arg, hits }, null, 2));
        return;
      }
      if (!hits.length) {
        console.log(`No package renders, styles or scripts "${arg}".`);
        return;
      }
      if (!hits[0].exact) console.log(`(no exact match — substring matches)`);
      for (const h of hits)
        console.log(`- ${h.pkg}: ${h.roles.join(", ")} ${h.token}`);
      return;
    }
    case "search": {
      if (!arg) fail("Missing search text.\n\n" + USAGE, asJson);
      const hits = search(cat, arg);
      if (asJson) {
        console.log(JSON.stringify({ query: arg, hits }, null, 2));
        return;
      }
      if (!hits.length) console.log(`No matches for "${arg}".`);
      for (const h of hits)
        console.log(`- ${h.pkg} (${h.score}): ${h.matches.join(" | ")}`);
      return;
    }
    default:
      fail(`Unknown command "${command}".\n\n${USAGE}`, asJson);
  }
}

// `catalog show x | head` closes stdout early; that is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main();
