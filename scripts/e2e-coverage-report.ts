/**
 * Browser-script coverage of the e2e suites, per plugin.
 *
 *   e2e-coverage-report [--dir .dev/e2e-coverage/raw] [--out .dev/e2e-coverage]
 *                       [--plugins a,b] [--limit 40 | --all] [--json]
 *
 * Reads the V8 coverage dumps the shared Playwright fixture writes when
 * `E2E_JS_COVERAGE=<dir>` is set (e2e/helpers/coverage-fixture.ts), attributes
 * served scripts to plugin `*.inline.ts` scripts (exact text match against a
 * source-mapped rebuild of each script; Quartz's re-minified prescript by
 * reproducing its join) and writes `<out>/REPORT.md` + `<out>/report.json`.
 * `just e2e-coverage` runs the suites with the env var and then this script.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "./lib/args.js";
import {
  analyzeCoverage,
  fingerprintOwner,
  locateLiterals,
  alignJoinedScript,
  summarizePlugins,
  type CoverageDump,
  type LiteralMatch,
} from "./lib/e2e-coverage/analyze.js";
import { discoverLiterals, stringTokens } from "./lib/e2e-coverage/discover.js";
import { renderMarkdown, toJson } from "./lib/e2e-coverage/render.js";
import { safeReadJson } from "./lib/json.js";
import { logError } from "./lib/log.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS = join(ROOT, "repos");

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      "Usage: just e2e-coverage-report [--dir <dumps>] [--out <dir>] [--plugins a,b] [--limit n | --all] [--json]",
    );
    return;
  }
  const dumpDir = resolve(
    ROOT,
    typeof flags.dir === "string" ? flags.dir : ".dev/e2e-coverage/raw",
  );
  const outDir = resolve(
    ROOT,
    typeof flags.out === "string" ? flags.out : ".dev/e2e-coverage",
  );
  const only =
    typeof flags.plugins === "string"
      ? new Set(["quartz", ...flags.plugins.split(",").filter(Boolean)])
      : undefined;
  const limit = flags.all
    ? 0
    : typeof flags.limit === "string"
      ? Number(flags.limit)
      : 40;

  if (!existsSync(dumpDir)) {
    logError("no coverage dumps", {
      dir: dumpDir,
      hint: "run `just e2e-coverage` (or set E2E_JS_COVERAGE=<dir> for playwright)",
    });
    process.exit(1);
  }
  const dumps: CoverageDump[] = readdirSync(dumpDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => safeReadJson<CoverageDump>(join(dumpDir, f)));
  const sourcesDir = join(dumpDir, "sources");
  const sources = new Map<string, string>();
  const urls = new Map<string, string>();
  for (const d of dumps)
    for (const e of d.entries) {
      urls.set(e.sourceHash, e.url);
      if (sources.has(e.sourceHash)) continue;
      const p = join(sourcesDir, `${e.sourceHash}.js`);
      if (existsSync(p)) sources.set(e.sourceHash, readFileSync(p, "utf-8"));
    }

  const { literals, distTexts, warnings } = await discoverLiterals(REPOS, only);
  const tokens = new Map(literals.map((l) => [l.id, stringTokens(l.code)]));

  const matches = new Map<string, LiteralMatch[]>();
  const owners = new Map<string, string | undefined>();
  for (const [hash, text] of sources) {
    let found = locateLiterals(text, literals);
    // Re-minified by Quartz: the prescript (beforeDOMLoaded) and inline
    // transformer resources (static/resource-*.js).
    if (
      found.length === 0 &&
      /prescript|\/resource-(before|after)-/.test(urls.get(hash) ?? "")
    ) {
      const candidates = literals.filter((l) => {
        const t = tokens.get(l.id) ?? [];
        if (t.length === 0) return false;
        const hits = t.filter((s) => text.includes(s)).length;
        return hits / t.length >= 0.8;
      });
      found = alignJoinedScript(text, candidates) ?? [];
      if (found.length === 0 && candidates.length)
        warnings.push(
          `${new URL(urls.get(hash)!).pathname}: functions do not align with ${candidates.map((c) => c.id).join(", ")}`,
        );
    }
    matches.set(hash, found);
    if (found.length === 0) {
      // Files a plugin ships with the site (externalResources().assets → static/plugins/<name>/)
      const asset = (urls.get(hash) ?? "").match(
        /\/static\/plugins\/([^/]+)\//,
      );
      owners.set(
        hash,
        asset
          ? `${asset[1]} (vendored asset)`
          : fingerprintOwner(text, distTexts),
      );
    }
  }

  const analysis = analyzeCoverage(
    literals,
    dumps,
    sources,
    (h) => matches.get(h) ?? [],
    (h) => owners.get(h),
  );
  const summaries = summarizePlugins(analysis);
  mkdirSync(outDir, { recursive: true });
  const json = toJson(analysis, summaries, warnings);
  writeFileSync(join(outDir, "report.json"), JSON.stringify(json, null, 2));
  const md = renderMarkdown(analysis, summaries, {
    limit,
    generatedAt: new Date().toISOString(),
    warnings,
  });
  writeFileSync(join(outDir, "REPORT.md"), md);

  if (flags.json) {
    console.log(JSON.stringify(json, null, 2));
    return;
  }
  console.log(`E2E browser-script coverage (${dumps.length} test dumps)`);
  for (const s of summaries) {
    const pct =
      s.percent === null ? "  –  " : `${s.percent.toFixed(1)}%`.padStart(6);
    const never = s.neverLoaded.length
      ? `  (${s.neverLoaded.length} script(s) never loaded)`
      : "";
    console.log(
      `  ${pct}  ${s.plugin.padEnd(34)} ${s.ownExecuted}/${s.ownFunctions}${never}`,
    );
  }
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log(`\nReport: ${join(outDir, "REPORT.md")}`);
}

main().catch((error) => {
  logError("e2e-coverage-report failed", {
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exit(1);
});
