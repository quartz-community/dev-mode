/**
 * Runtime tracer for a real Quartz build (experimental).
 *
 *   tsx scripts/trace.ts --site fixture:bug-repro [--name trace-bug-repro] [--json] [--verify]
 *   tsx scripts/trace.ts --config my.yaml --content path/to/content [--name trace-x]
 *
 * Builds the site in a dedicated sandbox whose Quartz source copy is patched
 * (scripts/lib/trace/patches.ts) to record, per plugin: file.data keys read /
 * written, time, emitted files, filtered pages, and components per page type.
 *
 * Output: .dev/trace/<name>/{raw.json,trace.json,TRACE.md}; site in .dev/sites/<name>.
 * --verify also builds the same site in an *unpatched* sandbox (<name>-baseline)
 * and diffs the HTML, proving the instrumentation does not change output.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "./lib/args.js";
import { safeReadJson } from "./lib/json.js";
import {
  BUILD_TIMEOUT_MS,
  DEV_DIR,
  SANDBOX_ROOT,
  SITES_ROOT,
  WORKSPACE_ROOT,
  buildSite,
  loadConfig,
  prepareConfiguredSandbox,
  rel,
  resolveBaseConfigPath,
  stripAnsi,
  validateSandboxName,
  withLock,
  type QuartzConfig,
} from "./lib/sandbox.js";
import { instrumentSandbox } from "./lib/trace/patches.js";
import type { RawTrace } from "./lib/trace/recorder.js";
import { analyzeTrace, renderMarkdown } from "./lib/trace/report.js";

function usage(): never {
  console.error(
    "Usage: tsx scripts/trace.ts (--site fixture:<name> | --config <yaml> --content <dir>) [--name <sandbox>] [--json] [--verify]",
  );
  process.exit(2);
}

function run(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        CI: process.env.CI ?? "1",
        ...env,
      },
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => (output += String(c)));
    child.stderr.on("data", (c: Buffer) => (output += String(c)));
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, output, timedOut });
    });
  });
}

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out.sort();
}

/** Normalise volatile bits (ISO timestamps, build dates) before comparing outputs. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<ts>")
    .replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/g, "<lastBuildDate/>");
}

function diffSites(
  a: string,
  b: string,
): { compared: number; onlyA: string[]; onlyB: string[]; differ: string[] } {
  const fa = listFiles(a);
  const fb = listFiles(b);
  const setB = new Set(fb);
  const setA = new Set(fa);
  const differ: string[] = [];
  let compared = 0;
  for (const f of fa) {
    if (!setB.has(f)) continue;
    if (!/\.(html|json|xml|css|js)$/.test(f)) continue;
    compared++;
    if (
      normalizeOutput(readFileSync(join(a, f), "utf-8")) !==
      normalizeOutput(readFileSync(join(b, f), "utf-8"))
    ) {
      differ.push(f);
    }
  }
  return {
    compared,
    onlyA: fa.filter((f) => !setB.has(f)),
    onlyB: fb.filter((f) => !setA.has(f)),
    differ,
  };
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const site = typeof flags.site === "string" ? flags.site : undefined;
  let config: QuartzConfig;
  let contentDir: string;
  let label: string;
  if (site) {
    if (!site.startsWith("fixture:")) usage();
    const fixture = site.slice("fixture:".length);
    config = loadConfig(resolveBaseConfigPath(site));
    contentDir = join(WORKSPACE_ROOT, "e2e/fixtures", fixture, "content");
    label = fixture;
  } else if (
    typeof flags.config === "string" &&
    typeof flags.content === "string"
  ) {
    config = loadConfig(resolveBaseConfigPath(flags.config));
    contentDir = isAbsolute(flags.content)
      ? flags.content
      : resolve(WORKSPACE_ROOT, flags.content);
    label = flags.config;
  } else {
    usage();
  }
  if (!existsSync(contentDir))
    throw new Error(`Content directory not found: ${contentDir}`);
  const name =
    typeof flags.name === "string"
      ? flags.name
      : `trace-${site ? label : "custom"}`;
  validateSandboxName(name);
  const traceDir = join(DEV_DIR, "trace", name);
  const rawPath = join(traceDir, "raw.json");
  const outDir = join(SITES_ROOT, name);
  const timeoutMs = BUILD_TIMEOUT_MS;

  const started = Date.now();
  const log = await withLock(
    join(SANDBOX_ROOT, `${name}.lock.d`),
    async () => {
      const prepared = await prepareConfiguredSandbox(name, config, timeoutMs);
      if (!prepared.ok)
        throw new Error(
          `install-plugins failed in sandbox ${name}:\n${prepared.log.slice(-4000)}`,
        );
      instrumentSandbox(prepared.dir);
      rmSync(rawPath, { force: true });
      const build = await run(
        // -c 1 keeps parsing on the main thread so the instrumented config is the one used.
        [
          "quartz/bootstrap-cli.mjs",
          "build",
          "-d",
          contentDir,
          "-o",
          "public",
          "-c",
          "1",
        ],
        prepared.dir,
        { QUARTZ_TRACE_OUT: rawPath },
        timeoutMs,
      );
      const text = prepared.log + stripAnsi(build.output);
      if (
        build.timedOut ||
        build.code !== 0 ||
        !existsSync(join(prepared.dir, "public"))
      ) {
        throw new Error(
          `Traced build failed (code ${build.code}${build.timedOut ? ", timed out" : ""}):\n${text.slice(-4000)}`,
        );
      }
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(SITES_ROOT, { recursive: true });
      renameSync(join(prepared.dir, "public"), outDir);
      return text;
    },
    timeoutMs * 2,
  );
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "build.log"), log);
  if (!existsSync(rawPath))
    throw new Error(
      `Build finished but no trace was written to ${rel(rawPath)} (see ${rel(join(traceDir, "build.log"))})`,
    );

  const raw = safeReadJson<RawTrace>(rawPath);
  const report = analyzeTrace(raw, site ?? label);

  let verify: ReturnType<typeof diffSites> | undefined;
  if (flags.verify) {
    const baseline = await buildSite({
      name: `${name}-baseline`,
      config,
      contentDir,
      timeoutMs,
    });
    if (!baseline.ok)
      throw new Error(`Baseline build failed; see ${rel(baseline.logPath)}`);
    verify = diffSites(baseline.outDir, outDir);
    report.warnings.push(
      verify.differ.length || verify.onlyA.length || verify.onlyB.length
        ? `verify: output DIFFERS from unpatched build — differ: ${verify.differ.slice(0, 10).join(", ")}; only baseline: ${verify.onlyA.slice(0, 10).join(", ")}; only traced: ${verify.onlyB.slice(0, 10).join(", ")}`
        : `verify: ${verify.compared} text files identical to an unpatched build (timestamps normalised)`,
    );
  }

  writeFileSync(join(traceDir, "trace.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(traceDir, "TRACE.md"), renderMarkdown(report));

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Traced ${report.site} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    console.log(`  actors:    ${report.pipeline.length}`);
    console.log(`  anomalies: ${report.anomalies.length}`);
    for (const w of report.warnings) console.log(`  ${w}`);
    console.log(`  report:    ${rel(join(traceDir, "TRACE.md"))}`);
    console.log(`  json:      ${rel(join(traceDir, "trace.json"))}`);
    console.log(`  site:      ${rel(outDir)}`);
  }
  if (
    verify &&
    (verify.differ.length || verify.onlyA.length || verify.onlyB.length)
  )
    process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
