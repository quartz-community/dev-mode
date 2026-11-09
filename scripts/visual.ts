/**
 * Visual + computed-style regression for rendered Quartz sites.
 *
 *   visual baseline [--site <target>] [capture options]   capture "base"
 *   visual check    [--threshold 0.001] [capture options] capture "head" (same site/pages
 *                                                          as base unless overridden) + compare
 *   visual capture <label> [--site <target>] [--config <yaml>] [--pages a,b] [--all]
 *                  [--viewports desktop,mobile] [--themes light,dark] [--no-build]
 *   visual compare <base> <head> [--threshold 0.001] [--tolerance 0] [--pixels-only]
 *
 * Output: .dev/visual/<label>/{manifest.json,screenshots/*.png,styles/*.json}
 *         .dev/visual/compare-<base>-<head>/{report.md,report.html,summary.json,diff/*.png}
 * Exit code 1 when a compare finds differences above the threshold (or any
 * computed-style/layout change unless --pixels-only).
 *
 * Typical agent loop: visual baseline → edit CSS → just build-plugin <x> → visual check
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { chromiumLaunchOptions } from "./lib/browser.js";
import { safeReadJson } from "./lib/json.js";
import {
  DETERMINISTIC_LAUNCH_ARGS,
  LAYOUT_SLOTS,
  collectSnapshotNodes,
  discoverPages,
  flagString,
  gotoSettled,
  isConsoleNoise,
  newProbeContext,
  normalizePage,
  pageFileName,
  pageUrlPath,
  parseCli,
  parseTheme,
  parseViewport,
  pickDefaultPages,
  splitList,
  type RawNode,
  type Theme,
} from "./lib/page-probe.js";
import { diffPngs } from "./lib/pixel-diff.js";
import { WORKSPACE_ROOT } from "./lib/sandbox.js";
import { formatStaleDists, prepareSite } from "./lib/site-target.js";
import { startStaticServer } from "./lib/static-server.js";
import {
  SNAPSHOT_PROPS,
  diffSnapshots,
  renderHtmlReport,
  renderMarkdownReport,
  shotId,
  summarizeCompare,
  toSnapshot,
  type PixelResult,
  type SnapshotDiff,
  type StyleSnapshot,
} from "./lib/visual-diff.js";

const VISUAL_DIR = join(WORKSPACE_ROOT, ".dev/visual");
const LABEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_NODES = 1500;
const MAX_DEPTH = 30;
/** Layout slots plus the center column, so keys stay short everywhere. */
const SNAPSHOT_SLOTS: [string, string][] = [
  ...LAYOUT_SLOTS,
  ["center", "#quartz-body > .center"],
];

const USAGE = `Usage:
  visual baseline [--site <target>] [--config <yaml>] [--pages a,b] [--all] [--viewports desktop,mobile] [--themes light,dark] [--no-build]
  visual check    [same options; defaults come from the base manifest] [--threshold 0.001] [--pixels-only]
  visual capture <label> [--site <target>] ...
  visual compare <base> <head> [--threshold 0.001] [--tolerance 0] [--pixels-only]
Targets: fixture:<name> | repro:<slug> | docs | <source dir> | <built dir> (with --base-path)`;

interface ShotEntry {
  id: string;
  page: string;
  viewport: string;
  theme: Theme;
  url: string;
  status?: number;
  screenshot: string;
  styles: string;
  consoleErrors: string[];
  error?: string;
}

interface Manifest {
  label: string;
  createdAt: string;
  site: string;
  config?: string;
  basePath: string;
  siteDir: string;
  pages: string[];
  viewports: string[];
  themes: Theme[];
  shots: ShotEntry[];
  warnings: string[];
  notes: string[];
}

interface CaptureOptions {
  site: string;
  config?: string;
  basePath?: string;
  noBuild: boolean;
  pages?: string[];
  all: boolean;
  viewports: string[];
  themes: Theme[];
  verbose: boolean;
}

function labelDir(label: string): string {
  if (!LABEL_RE.test(label))
    throw new Error(`Invalid label "${label}" (letters, digits, . _ -)`);
  return join(VISUAL_DIR, label);
}

function readManifest(label: string): Manifest {
  const path = join(labelDir(label), "manifest.json");
  if (!existsSync(path))
    throw new Error(
      `No capture "${label}" (${relative(WORKSPACE_ROOT, path)}); run visual capture ${label} first`,
    );
  return safeReadJson<Manifest>(path);
}

async function capture(label: string, opts: CaptureOptions): Promise<Manifest> {
  const outDir = labelDir(label);
  const started = Date.now();
  const site = await prepareSite(opts.site, {
    noBuild: opts.noBuild,
    config: opts.config,
    basePath: opts.basePath,
    verbose: opts.verbose,
    // Separate output per label so base and head builds don't overwrite each other.
    name: `${opts.site
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+/, "")
      .slice(0, 40)}-visual-${label}`,
  });
  const warnings = formatStaleDists(site.build);
  for (const w of warnings) console.error(w);

  const discovered = discoverPages(site.siteDir);
  let pages: string[];
  if (opts.pages?.length) pages = opts.pages.map(normalizePage);
  else if (opts.all) pages = discovered.map((p) => p.slug);
  else pages = pickDefaultPages(discovered);
  if (!pages.length) throw new Error(`No pages found in ${site.siteDir}`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });
  mkdirSync(join(outDir, "styles"), { recursive: true });

  const server = await startStaticServer({
    root: site.siteDir,
    basePath: site.basePath,
  });
  const browser = await chromium.launch({
    ...chromiumLaunchOptions(),
    args: DETERMINISTIC_LAUNCH_ARGS,
    timeout: 60_000,
  });
  const shots: ShotEntry[] = [];
  let maskedCanvases = 0;
  const unstable = new Set<string>();
  try {
    for (const vpName of opts.viewports) {
      const viewport = parseViewport(vpName);
      for (const theme of opts.themes) {
        for (const slug of pages) {
          // Fresh context per shot: no localStorage/sessionStorage (explorer
          // state, scroll positions) leaking from previously visited pages.
          const context = await newProbeContext(browser, {
            viewport,
            theme,
            deterministic: true,
            siteBaseUrl: site.config?.configuration.baseUrl,
            localBase: server.baseUrl,
          });
          const page = await context.newPage();
          const consoleErrors: string[] = [];
          page.on("console", (msg) => {
            if (msg.type() === "error" && !isConsoleNoise(msg.text()))
              consoleErrors.push(msg.text().slice(0, 300));
          });
          page.on("pageerror", (err) =>
            consoleErrors.push(`pageerror: ${err.message}`.slice(0, 300)),
          );
          const file = pageFileName(slug);
          const id = shotId(file, viewport.name, theme);
          const url = server.url(pageUrlPath(slug));
          const entry: ShotEntry = {
            id,
            page: slug,
            viewport: viewport.name,
            theme,
            url: pageUrlPath(slug),
            screenshot: `screenshots/${id}.png`,
            styles: `styles/${id}.json`,
            consoleErrors,
          };
          try {
            entry.status = await gotoSettled(page, url, {
              theme,
              deterministic: true,
            });
            await page.waitForTimeout(150);
            await page.evaluate(() => window.scrollTo(0, 0));
            const canvases = page.locator("canvas");
            maskedCanvases += await canvases.count();
            // Like toHaveScreenshot: re-shoot until two consecutive frames match.
            const shoot = () =>
              page.screenshot({
                fullPage: true,
                animations: "disabled",
                caret: "hide",
                mask: [canvases],
                maskColor: "#ff00ff",
                scale: "css",
              });
            let png = await shoot();
            for (let attempt = 0; attempt < 4; attempt += 1) {
              await page.waitForTimeout(100);
              const next = await shoot();
              if (next.equals(png)) break;
              png = next;
              unstable.add(id);
            }
            writeFileSync(join(outDir, entry.screenshot), png);
            const raw = (await page.evaluate(collectSnapshotNodes, {
              slots: SNAPSHOT_SLOTS,
              props: SNAPSHOT_PROPS,
              maxNodes: MAX_NODES,
              maxDepth: MAX_DEPTH,
            })) as {
              nodes: RawNode[];
              truncated: boolean;
              rootVars: Record<string, string>;
              docHeight: number;
            };
            const snapshot = toSnapshot(
              { shot: id, page: slug, viewport: viewport.name, theme },
              raw,
            );
            writeFileSync(join(outDir, entry.styles), JSON.stringify(snapshot));
          } catch (error) {
            entry.error =
              error instanceof Error
                ? error.message.split("\n")[0]
                : String(error);
          }
          await context.close();
          shots.push(entry);
          console.error(
            `  ${entry.error ? "✗" : "✓"} ${id}${entry.error ? `  ${entry.error}` : ""}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const notes = [
    "Deterministic capture: reduced motion, animations/transitions/caret disabled, Date frozen at 2024-01-01T12:00Z, Math.random seeded, fonts awaited.",
  ];
  if (maskedCanvases)
    notes.push(
      `canvas elements (e.g. graph view) are masked magenta in screenshots (${maskedCanvases} masked); their contents are not compared.`,
    );
  if (unstable.size) {
    notes.push(
      `screenshots needed re-shooting to stabilize (late font/glyph rendering): ${[...unstable].join(", ")}`,
    );
  }
  const manifest: Manifest = {
    label,
    createdAt: new Date().toISOString(),
    site: opts.site,
    config: opts.config,
    basePath: site.basePath,
    siteDir: relative(WORKSPACE_ROOT, site.siteDir) || site.siteDir,
    pages,
    viewports: opts.viewports,
    themes: opts.themes,
    shots,
    warnings,
    notes,
  };
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  const failed = shots.filter((s) => s.error).length;
  console.error(
    `captured ${shots.length - failed}/${shots.length} shots (${pages.length} pages × ${opts.viewports.length} viewports × ${opts.themes.length} themes) → ${relative(WORKSPACE_ROOT, outDir)} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  if (failed) throw new Error(`${failed} shots failed to capture`);
  return manifest;
}

interface CompareOptions {
  threshold: number;
  tolerance: number;
  pixelsOnly: boolean;
}

async function compare(
  baseLabel: string,
  headLabel: string,
  opts: CompareOptions,
): Promise<boolean> {
  const base = readManifest(baseLabel);
  const head = readManifest(headLabel);
  const baseDir = labelDir(baseLabel);
  const headDir = labelDir(headLabel);
  const outDir = join(VISUAL_DIR, `compare-${baseLabel}-${headLabel}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "diff"), { recursive: true });

  const headById = new Map(head.shots.map((s) => [s.id, s]));
  const baseIds = new Set(base.shots.map((s) => s.id));
  const missingInHead = base.shots
    .filter((s) => !headById.has(s.id))
    .map((s) => s.id);
  const missingInBase = head.shots
    .filter((s) => !baseIds.has(s.id))
    .map((s) => s.id);

  const pixels: PixelResult[] = [];
  const diffs: SnapshotDiff[] = [];
  const images = new Map<
    string,
    { base?: string; head?: string; diff?: string }
  >();
  const browser: Browser = await chromium.launch({
    ...chromiumLaunchOptions(),
    timeout: 60_000,
  });
  try {
    const page = await browser.newPage();
    for (const b of base.shots) {
      const h = headById.get(b.id);
      if (!h || b.error || h.error) continue;
      const basePng = readFileSync(join(baseDir, b.screenshot));
      const headPng = readFileSync(join(headDir, h.screenshot));
      const { result, diffPng } = await diffPngs(
        page,
        b.id,
        basePng,
        headPng,
        opts.tolerance,
      );
      pixels.push(result);
      const img: { base?: string; head?: string; diff?: string } = {
        base: relative(outDir, join(baseDir, b.screenshot)),
        head: relative(outDir, join(headDir, h.screenshot)),
      };
      if (diffPng) {
        writeFileSync(join(outDir, "diff", `${b.id}.png`), diffPng);
        img.diff = `diff/${b.id}.png`;
      }
      images.set(b.id, img);
      const baseSnap = safeReadJson<StyleSnapshot>(join(baseDir, b.styles));
      const headSnap = safeReadJson<StyleSnapshot>(join(headDir, h.styles));
      diffs.push(diffSnapshots(baseSnap, headSnap));
    }
  } finally {
    await browser.close();
  }

  const summary = summarizeCompare(
    pixels,
    diffs,
    missingInHead,
    missingInBase,
    {
      threshold: opts.threshold,
      pixelsOnly: opts.pixelsOnly,
    },
  );
  const notes = [...new Set([...base.notes, ...head.notes])];
  if (base.site !== head.site || base.config !== head.config) {
    notes.push(
      `base site: ${base.site}${base.config ? ` + ${base.config}` : ""}; head site: ${head.site}${head.config ? ` + ${head.config}` : ""}`,
    );
  }
  for (const w of head.warnings) notes.push(`head: ${w}`);
  const input = {
    base: baseLabel,
    head: headLabel,
    threshold: opts.threshold,
    pixels,
    diffs,
    summary,
    notes,
  };
  const md = renderMarkdownReport(input);
  writeFileSync(join(outDir, "report.md"), md);
  writeFileSync(join(outDir, "report.html"), renderHtmlReport(input, images));
  writeFileSync(
    join(outDir, "summary.json"),
    JSON.stringify(
      {
        base: baseLabel,
        head: headLabel,
        threshold: opts.threshold,
        summary,
        pixels,
        diffs,
      },
      null,
      2,
    ),
  );

  const lines = md.split("\n");
  const MAX_LINES = 120;
  console.log(lines.slice(0, MAX_LINES).join("\n"));
  if (lines.length > MAX_LINES)
    console.log(`… (${lines.length - MAX_LINES} more lines)`);
  const rel = (p: string) => relative(WORKSPACE_ROOT, p);
  console.log(`report: ${rel(join(outDir, "report.md"))}`);
  console.log(`html:   ${rel(join(outDir, "report.html"))}`);
  const changedDiffs = pixels.filter((p) => p.changedPixels > 0).slice(0, 5);
  for (const p of changedDiffs)
    console.log(`diff:   ${rel(join(outDir, "diff", `${p.shot}.png`))}`);
  return summary.failed;
}

function captureOptions(
  flags: Record<string, string | boolean>,
  defaults?: Manifest,
): CaptureOptions {
  const site =
    flagString(flags, "site") ?? defaults?.site ?? "fixture:bug-repro";
  // A different --site drops the base's config/pages unless given again.
  const sameSite =
    !flagString(flags, "site") || flagString(flags, "site") === defaults?.site;
  const pagesFlag = splitList(flags.pages);
  return {
    site,
    config:
      (flagString(flags, "config") && resolve(flagString(flags, "config")!)) ||
      (sameSite ? defaults?.config : undefined),
    basePath:
      flagString(flags, "base-path") ??
      (sameSite && defaults ? defaults.basePath : undefined),
    noBuild: flags["no-build"] === true,
    pages: pagesFlag.length
      ? pagesFlag
      : flags.all === true
        ? undefined
        : sameSite
          ? defaults?.pages
          : undefined,
    all: flags.all === true,
    viewports: splitList(
      flags.viewports,
      defaults?.viewports ?? ["desktop", "mobile"],
    ).map((v) => parseViewport(v).name),
    themes: splitList(flags.themes, defaults?.themes ?? ["light", "dark"]).map(
      parseTheme,
    ),
    verbose: flags.verbose === true,
  };
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2), {
    booleans: ["all", "no-build", "pixels-only", "verbose", "help"],
  });
  const [command, ...rest] = cli.positional;
  if (!command || cli.flags.help) {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const compareOpts: CompareOptions = {
    threshold: Number(flagString(cli.flags, "threshold") ?? 0.001),
    tolerance: Number(flagString(cli.flags, "tolerance") ?? 0),
    pixelsOnly: cli.flags["pixels-only"] === true,
  };
  if (!Number.isFinite(compareOpts.threshold) || compareOpts.threshold < 0)
    throw new Error(
      "--threshold must be a number ≥ 0 (fraction, 0.001 = 0.1%)",
    );
  switch (command) {
    case "capture": {
      const label = rest[0];
      if (!label) throw new Error("capture needs a <label>");
      await capture(label, captureOptions(cli.flags));
      return 0;
    }
    case "baseline":
      await capture("base", captureOptions(cli.flags));
      return 0;
    case "check": {
      const base = readManifest("base");
      await capture("head", captureOptions(cli.flags, base));
      return (await compare("base", "head", compareOpts)) ? 1 : 0;
    }
    case "compare": {
      const [baseLabel, headLabel] = rest;
      if (!baseLabel || !headLabel)
        throw new Error("compare needs <base> <head>");
      return (await compare(baseLabel, headLabel, compareOpts)) ? 1 : 0;
    }
    default:
      console.log(USAGE);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(
      `visual: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  },
);
