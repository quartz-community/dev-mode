/**
 * Inspect rendered Quartz pages: console/page errors, failed requests, layout
 * map, horizontal overflow, computed styles for selectors, optional HTML dump
 * and screenshot.
 *
 *   pnpm tsx scripts/inspect.ts <target> [page ...] [options]
 *
 * Target: fixture:<name> | repro:<slug> | docs | <source dir> | <built dir>
 * Options:
 *   --viewport desktop|tablet|mobile|WxH   (default desktop)
 *   --theme light|dark                      (default light)
 *   --selector <css>      repeatable; count, boxes and computed styles
 *   --html <css>          repeatable; outerHTML (truncated) of matches
 *   --click <css>         click before inspecting (e.g. open search)
 *   --screenshot          save .dev/inspect/<target>/<page>-<viewport>-<theme>.png
 *   --full-page           full-page screenshot (implies --screenshot)
 *   --config <yaml>       build with this config/overlay instead of the target's
 *   --base-path <p>       base path for built dirs (default "")
 *   --no-build            reuse the last build
 *   --wait <ms>           extra wait after load
 *   --json                full JSON report on stdout
 *   --out <dir>           screenshot directory
 */
import { mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, type Browser, type ConsoleMessage } from "@playwright/test";
import { chromiumLaunchOptions } from "./lib/browser.js";
import {
  LAYOUT_SLOTS,
  STYLE_PROPS,
  collectLayout,
  collectSelectors,
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
  type LayoutSlot,
  type OverflowInfo,
  type SelectorReport,
  type Theme,
  type Viewport,
} from "./lib/page-probe.js";
import { WORKSPACE_ROOT } from "./lib/sandbox.js";
import { formatStaleDists, prepareSite } from "./lib/site-target.js";
import { startStaticServer } from "./lib/static-server.js";
import {
  formatInspectReport,
  type PageInspection,
} from "./lib/inspect-report.js";

const USAGE = `Usage: inspect <target> [page ...] [--viewport desktop|tablet|mobile|WxH] [--theme light|dark]
  [--selector <css>]... [--html <css>]... [--click <css>] [--screenshot] [--full-page]
  [--config <yaml>] [--base-path <p>] [--no-build] [--wait <ms>] [--json] [--out <dir>]`;

interface InspectOptions {
  viewport: Viewport;
  theme: Theme;
  selectors: string[];
  html: string[];
  click?: string;
  screenshot: boolean;
  fullPage: boolean;
  waitMs: number;
  outDir: string;
  siteBaseUrl?: unknown;
  localBase?: string;
}

async function inspectPage(
  browser: Browser,
  url: string,
  slug: string,
  opts: InspectOptions,
): Promise<PageInspection> {
  const context = await newProbeContext(browser, {
    viewport: opts.viewport,
    theme: opts.theme,
    deterministic: false,
    siteBaseUrl: opts.siteBaseUrl,
    localBase: opts.localBase,
  });
  const page = await context.newPage();
  const consoleMessages: PageInspection["console"] = [];
  const pageErrors: string[] = [];
  const failedRequests: PageInspection["failedRequests"] = [];
  page.on("console", (msg: ConsoleMessage) => {
    const type = msg.type();
    if (
      (type === "error" || type === "warning") &&
      !isConsoleNoise(msg.text())
    ) {
      const loc = msg.location();
      consoleMessages.push({
        type,
        text: msg.text().slice(0, 500),
        location: loc.url
          ? `${loc.url.replace(/^https?:\/\/[^/]+/, "")}:${loc.lineNumber}`
          : undefined,
      });
    }
  });
  page.on("pageerror", (err) =>
    pageErrors.push(`${err.name}: ${err.message}`.slice(0, 500)),
  );
  page.on("requestfailed", (req) =>
    failedRequests.push({
      url: req.url(),
      status: 0,
      error: req.failure()?.errorText ?? "failed",
    }),
  );
  page.on("response", (res) => {
    if (res.status() >= 400)
      failedRequests.push({ url: res.url(), status: res.status() });
  });

  const result: PageInspection = {
    page: slug,
    url,
    viewport: `${opts.viewport.name} (${opts.viewport.width}x${opts.viewport.height})`,
    theme: opts.theme,
    console: consoleMessages,
    pageErrors,
    failedRequests,
    layout: [],
    selectors: [],
  };
  try {
    result.status = await gotoSettled(page, url, {
      theme: opts.theme,
      deterministic: false,
    });
    if (opts.click) {
      await page.locator(opts.click).first().click({ timeout: 5_000 });
      await page.waitForTimeout(400);
      result.clicked = opts.click;
    }
    if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
    const layout = (await page.evaluate(collectLayout, LAYOUT_SLOTS)) as {
      layout: LayoutSlot[];
      overflow: OverflowInfo;
      title: string;
      slug: string;
    };
    result.title = layout.title;
    result.dataSlug = layout.slug;
    result.layout = layout.layout;
    result.overflow = layout.overflow;
    if (opts.selectors.length || opts.html.length) {
      result.selectors = (await page.evaluate(collectSelectors, {
        selectors: opts.selectors,
        htmlSelectors: opts.html,
        props: [...STYLE_PROPS],
        maxBoxes: 10,
        maxHtml: 2_000,
      })) as SelectorReport[];
    }
    if (opts.screenshot) {
      mkdirSync(opts.outDir, { recursive: true });
      const file = join(
        opts.outDir,
        `${pageFileName(slug)}-${opts.viewport.name}-${opts.theme}.png`,
      );
      await page.screenshot({
        path: file,
        fullPage: opts.fullPage,
        animations: "disabled",
        caret: "hide",
      });
      result.screenshot = relative(WORKSPACE_ROOT, file);
    }
  } catch (error) {
    result.error =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
  } finally {
    await context.close();
  }
  return result;
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2), {
    booleans: [
      "screenshot",
      "full-page",
      "json",
      "no-build",
      "verbose",
      "help",
    ],
    repeatable: ["selector", "html"],
  });
  if (cli.flags.help || !cli.positional.length) {
    console.log(USAGE);
    return cli.flags.help ? 0 : 2;
  }
  const [spec, ...pageArgs] = cli.positional;
  const asJson = cli.flags.json === true;
  const opts: InspectOptions = {
    viewport: parseViewport(flagString(cli.flags, "viewport") ?? "desktop"),
    theme: parseTheme(flagString(cli.flags, "theme") ?? "light"),
    selectors: cli.lists.selector,
    html: cli.lists.html,
    click: flagString(cli.flags, "click"),
    screenshot:
      cli.flags.screenshot === true || cli.flags["full-page"] === true,
    fullPage: cli.flags["full-page"] === true,
    waitMs: Number(flagString(cli.flags, "wait") ?? 0),
    outDir: "",
  };

  const site = await prepareSite(spec, {
    noBuild: cli.flags["no-build"] === true,
    config: flagString(cli.flags, "config"),
    basePath: flagString(cli.flags, "base-path"),
    verbose: cli.flags.verbose === true,
  });
  const warnings = [...formatStaleDists(site.build)];
  const outFlag = flagString(cli.flags, "out");
  opts.outDir = outFlag
    ? resolve(outFlag)
    : join(WORKSPACE_ROOT, ".dev/inspect", site.target.id);

  const pages = (pageArgs.length ? pageArgs : ["index"]).map(normalizePage);
  const server = await startStaticServer({
    root: site.siteDir,
    basePath: site.basePath,
  });
  opts.siteBaseUrl = site.config?.configuration.baseUrl;
  opts.localBase = server.baseUrl;
  const browser = await chromium.launch({
    ...chromiumLaunchOptions(),
    timeout: 60_000,
  });
  const results: PageInspection[] = [];
  try {
    for (const slug of pages) {
      results.push(
        await inspectPage(browser, server.url(pageUrlPath(slug)), slug, opts),
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const header = {
    target: site.target.spec,
    siteDir: relative(WORKSPACE_ROOT, site.siteDir) || site.siteDir,
    basePath: site.basePath,
    buildMs: site.build?.durationMs,
    warnings,
  };
  if (asJson) {
    console.log(JSON.stringify({ ...header, pages: results }, null, 2));
  } else {
    console.log(formatInspectReport(header, results));
  }
  return results.some(
    (r) => r.error || (r.status !== undefined && r.status >= 400),
  )
    ? 1
    : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(
      `inspect: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  },
);
