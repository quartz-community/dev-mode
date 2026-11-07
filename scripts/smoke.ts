/**
 * Whole-site smoke test for any Quartz site target.
 *
 *   smoke <target> [--no-build] [--max-pages 200] [--no-browser] [--spa 5] [--json]
 *
 * 1. Static pass (no browser, every HTML file): broken internal links and
 *    missing assets (href/src that resolve to nothing under the base path).
 * 2. Browser pass (up to --max-pages pages): console errors, uncaught page
 *    errors, failed requests / HTTP >= 400, horizontal overflow at mobile width.
 * 3. SPA pass: from the index, follow --spa internal links by clicking and
 *    record errors that only appear after client-side navigation.
 *
 * Exit code 1 if any problem is found. Useful as a regression check on a real
 * vault: put it in a dir with content/ (+ optional quartz.config.yaml overlay).
 */
/// <reference lib="dom" />
import { chromium, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "./lib/args.js";
import { chromiumLaunchOptions } from "./lib/browser.js";
import { rel } from "./lib/sandbox.js";
import { routeProductionUrls } from "./lib/page-routing.js";
import { formatStaleDists, prepareSite } from "./lib/site-target.js";
import { resolveSiteFile, startStaticServer } from "./lib/static-server.js";

export interface Problem {
  kind:
    | "broken-link"
    | "missing-asset"
    | "console-error"
    | "page-error"
    | "http-error"
    | "request-failed"
    | "mobile-overflow"
    | "spa-error";
  page: string;
  detail: string;
}

function walkHtml(dir: string, root = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, root, out);
    else if (entry.name.endsWith(".html")) out.push(relative(root, full));
  }
  return out.sort();
}

/** Site-relative page path for an HTML file ("docs/index.html" -> "docs/"). */
export function pagePathFor(file: string): string {
  if (file === "index.html") return "";
  if (file.endsWith("/index.html")) return file.slice(0, -"index.html".length);
  return file.replace(/\.html$/, "");
}

/**
 * Extract href/src targets from HTML and return those that are internal
 * (same site) as site-relative paths, given the page's own site path.
 */
export function internalTargets(
  html: string,
  pagePath: string,
  basePath: string,
): { attr: string; target: string; raw: string }[] {
  const results: { attr: string; target: string; raw: string }[] = [];
  const re = /\s(href|src)=("([^"]*)"|'([^']*)')/g;
  const pageUrl = new URL(`http://site${basePath}/${pagePath}`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[3] ?? m[4] ?? "").replace(/&amp;/g, "&");
    if (
      !raw ||
      raw.startsWith("#") ||
      /^(data|mailto|tel|javascript):/i.test(raw)
    )
      continue;
    if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith("//")) continue; // external
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (url.host !== "site") continue;
    let path = decodeURIComponent(url.pathname);
    if (basePath) {
      if (!(path === basePath || path.startsWith(`${basePath}/`))) {
        results.push({
          attr: m[1],
          target: `(outside base path) ${path}`,
          raw,
        });
        continue;
      }
      path = path.slice(basePath.length);
    }
    results.push({ attr: m[1], target: path || "/", raw });
  }
  return results;
}

function staticPass(
  siteDir: string,
  basePath: string,
  files: string[],
): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (file === "404.html") continue;
    const html = readFileSync(join(siteDir, file), "utf-8");
    // Skip <head> preload hints duplicates by de-duping per page+target.
    for (const { attr, target, raw } of internalTargets(
      html,
      pagePathFor(file),
      basePath,
    )) {
      const key = `${file}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const outside = target.startsWith("(outside base path)");
      if (outside || !resolveSiteFile(siteDir, target)) {
        problems.push({
          kind:
            attr === "href" &&
            !/\.(css|js|png|jpe?g|svg|webp|ico|woff2?)$/i.test(target)
              ? "broken-link"
              : "missing-asset",
          page: pagePathFor(file) || "/",
          detail: `${attr}="${raw}" → ${target}`,
        });
      }
    }
  }
  return problems;
}

function attachCollectors(
  page: Page,
  pagePath: string,
  sink: Problem[],
  kindPrefix?: "spa-error",
) {
  page.on("console", (msg) => {
    if (msg.type() === "error")
      sink.push({
        kind: kindPrefix ?? "console-error",
        page: pagePath,
        detail: msg.text().slice(0, 300),
      });
  });
  page.on("pageerror", (err) =>
    sink.push({
      kind: kindPrefix ?? "page-error",
      page: pagePath,
      detail: err.message.slice(0, 300),
    }),
  );
  page.on("requestfailed", (req) =>
    sink.push({
      kind: kindPrefix ?? "request-failed",
      page: pagePath,
      detail: `${req.url()} (${req.failure()?.errorText ?? "?"})`,
    }),
  );
  page.on("response", (res) => {
    if (res.status() >= 400)
      sink.push({
        kind: kindPrefix ?? "http-error",
        page: pagePath,
        detail: `HTTP ${res.status()} ${res.url()}`,
      });
  });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const spec = positional[0];
  if (!spec) {
    console.error(
      "Usage: smoke <target> [--no-build] [--max-pages 200] [--no-browser] [--spa 5] [--json]",
    );
    process.exit(1);
  }
  const maxPages = Number(
    typeof flags["max-pages"] === "string" ? flags["max-pages"] : 200,
  );
  const spaHops = Number(typeof flags.spa === "string" ? flags.spa : 5);
  const prepared = await prepareSite(spec, {
    noBuild: Boolean(flags["no-build"]),
    basePath:
      typeof flags["base-path"] === "string" ? flags["base-path"] : undefined,
  });
  const files = walkHtml(prepared.siteDir);
  const problems: Problem[] = staticPass(
    prepared.siteDir,
    prepared.basePath,
    files,
  );
  let visited = 0;

  if (!flags["no-browser"]) {
    const server = await startStaticServer({
      root: prepared.siteDir,
      basePath: prepared.basePath,
    });
    const browser = await chromium.launch(chromiumLaunchOptions());
    try {
      const pages = files.filter((f) => f !== "404.html").slice(0, maxPages);
      const desktop = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const mobile = await browser.newContext({
        viewport: { width: 375, height: 812 },
        isMobile: true,
      });
      for (const ctx of [desktop, mobile]) {
        await routeProductionUrls(ctx, {
          baseUrl: prepared.config?.configuration.baseUrl,
          siteDir: prepared.siteDir,
        });
      }
      for (const file of pages) {
        const pagePath = pagePathFor(file);
        const page = await desktop.newPage();
        attachCollectors(page, pagePath || "/", problems);
        await page
          .goto(server.url(pagePath), {
            waitUntil: "networkidle",
            timeout: 20_000,
          })
          .catch((e: Error) =>
            problems.push({
              kind: "page-error",
              page: pagePath || "/",
              detail: `navigation: ${e.message.split("\n")[0]}`,
            }),
          );
        await page.close();
        visited += 1;
      }
      // Mobile overflow on a sample (overflow is mostly layout-wide, not per page).
      for (const file of pages.slice(0, 10)) {
        const pagePath = pagePathFor(file);
        const page = await mobile.newPage();
        await page
          .goto(server.url(pagePath), {
            waitUntil: "networkidle",
            timeout: 20_000,
          })
          .catch(() => undefined);
        const overflow = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          const culprits: string[] = [];
          for (const el of Array.from(
            document.querySelectorAll<HTMLElement>("body *"),
          )) {
            const r = el.getBoundingClientRect();
            if (
              r.width > 0 &&
              r.right > width + 1 &&
              getComputedStyle(el).position !== "fixed"
            ) {
              // Only report outermost offenders.
              const parent = el.parentElement;
              if (parent && parent.getBoundingClientRect().right > width + 1)
                continue;
              culprits.push(
                `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} (right=${Math.round(r.right)})`,
              );
            }
          }
          return {
            scrollWidth: document.documentElement.scrollWidth,
            width,
            culprits: culprits.slice(0, 5),
          };
        });
        if (overflow.scrollWidth > overflow.width + 1) {
          problems.push({
            kind: "mobile-overflow",
            page: pagePath || "/",
            detail: `scrollWidth ${overflow.scrollWidth} > ${overflow.width}; ${overflow.culprits.join(", ") || "no single culprit found"}`,
          });
        }
        await page.close();
      }
      // SPA hops from the index.
      if (spaHops > 0) {
        const page = await desktop.newPage();
        const spaProblems: Problem[] = [];
        await page.goto(server.url(""), { waitUntil: "networkidle" });
        attachCollectors(page, "(spa)", spaProblems, "spa-error");
        for (let hop = 0; hop < spaHops; hop += 1) {
          const links = page.locator(
            "article a.internal:visible, .center a.internal:visible",
          );
          const count = await links.count();
          if (!count) break;
          const link = links.nth(hop % count);
          const href = await link.getAttribute("href");
          const before = page.url();
          await link.click({ timeout: 5_000 }).catch(() => undefined);
          await page
            .waitForURL((u) => u.toString() !== before, { timeout: 5_000 })
            .catch(() => undefined);
          await page.waitForLoadState("networkidle").catch(() => undefined);
          for (const p of spaProblems.splice(0))
            problems.push({
              ...p,
              page: `${new URL(before).pathname} → ${href}`,
            });
        }
        await page.close();
      }
      await desktop.close();
      await mobile.close();
    } finally {
      await browser.close();
      await server.close();
    }
  }

  const byKind = new Map<string, Problem[]>();
  for (const p of problems)
    byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          target: prepared.target.spec,
          siteDir: prepared.siteDir,
          htmlFiles: files.length,
          visited,
          problems,
          staleDists: prepared.build?.staleDists ?? [],
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `Smoke ${prepared.target.spec} — ${files.length} HTML files, ${visited} visited in browser (${rel(prepared.siteDir)})`,
    );
    for (const line of formatStaleDists(prepared.build)) console.log(line);
    if (!problems.length) console.log("✓ No problems found");
    for (const [kind, list] of byKind) {
      console.log(`\n✗ ${kind} (${list.length})`);
      // Group identical details across pages.
      const grouped = new Map<string, string[]>();
      for (const p of list)
        grouped.set(p.detail, [...(grouped.get(p.detail) ?? []), p.page]);
      for (const [detail, pages] of [...grouped].slice(0, 25)) {
        const where =
          pages.length > 3
            ? `${pages.slice(0, 3).join(", ")} +${pages.length - 3} more`
            : pages.join(", ");
        console.log(`  ${detail}\n      on: ${where}`);
      }
      if (grouped.size > 25)
        console.log(`  … ${grouped.size - 25} more distinct`);
    }
  }
  process.exit(problems.length ? 1 : 0);
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
