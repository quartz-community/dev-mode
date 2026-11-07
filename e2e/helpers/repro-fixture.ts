/**
 * Playwright fixtures for self-contained repros (e2e/repros/<slug>/).
 *
 * Each repro spec lives next to its own content/ and (optional)
 * quartz.config.yaml overlay. The `site` fixture builds that repro in an
 * isolated sandbox (once per test run, shared across workers via a lock +
 * marker file) and serves it on a free port. No global webServer entry or
 * port bookkeeping is needed.
 *
 *   import { test, expect } from "../../helpers/repro-fixture";
 *   test("callout title", async ({ page, site, pageProblems }) => {
 *     await page.goto(site.url("features/callouts"));
 *     expect(pageProblems.all()).toEqual([]);
 *   });
 *
 * `pageProblems` collects console errors, uncaught exceptions, failed requests
 * and HTTP >= 400 responses for the current test.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { SITES_ROOT, withLock } from "../../scripts/lib/sandbox.js";
import {
  formatStaleDists,
  prepareSite,
  REPROS_DIR,
} from "../../scripts/lib/site-target.js";
import {
  startStaticServer,
  type StaticServerHandle,
} from "../../scripts/lib/static-server.js";

export interface ReproSite {
  slug: string;
  /** Built site directory. */
  dir: string;
  /** Origin + base path, no trailing slash. */
  baseUrl: string;
  /** Full URL for a site-relative page path, e.g. site.url("docs/page"). */
  url(pagePath?: string): string;
}

export interface PageProblems {
  console: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Everything in one list, for `expect(pageProblems.all()).toEqual([])`. */
  all(): string[];
}

export function slugFromTestFile(file: string): string {
  const rel = relative(REPROS_DIR, file);
  if (rel.startsWith("..")) {
    throw new Error(`repro-fixture used outside e2e/repros/: ${file}`);
  }
  return rel.split(/[\\/]/)[0];
}

/** Build a repro once per test run (REPRO_RUN_ID is set by the global setup). */
export async function ensureBuilt(
  slug: string,
): Promise<{ siteDir: string; basePath: string }> {
  const runId = process.env.REPRO_RUN_ID ?? `adhoc-${process.ppid}`;
  const name = `repro-${slug}`;
  const marker = join(SITES_ROOT, `${name}.run.json`);
  return withLock(join(SITES_ROOT, `${name}.build.d`), async () => {
    if (existsSync(marker)) {
      try {
        const prev = JSON.parse(readFileSync(marker, "utf-8")) as {
          runId: string;
          siteDir: string;
          basePath: string;
        };
        if (prev.runId === runId && existsSync(prev.siteDir)) return prev;
      } catch {
        // fall through and rebuild
      }
    }
    const prepared = await prepareSite(`repro:${slug}`, { name });
    for (const line of formatStaleDists(prepared.build))
      console.warn(`[repro:${slug}] ${line}`);
    const result = {
      runId,
      siteDir: prepared.siteDir,
      basePath: prepared.basePath,
    };
    writeFileSync(marker, JSON.stringify(result));
    return result;
  });
}

// One server per slug per worker process.
const servers = new Map<string, Promise<StaticServerHandle>>();

/** Read `status:` from the repro README frontmatter. */
export function reproStatus(slug: string): string | undefined {
  const readme = join(REPROS_DIR, slug, "README.md");
  if (!existsSync(readme)) return undefined;
  const m = readFileSync(readme, "utf-8").match(
    /^---\n[\s\S]*?^status:\s*([a-z-]+)/m,
  );
  return m?.[1];
}

const UNFIXED = new Set(["open", "reproduced"]);

export const test = base.extend<
  {
    site: ReproSite;
    pageProblems: PageProblems;
    _expectFailWhileUnfixed: void;
  },
  { _closeServers: void }
>({
  // Unfixed repros (README status open|reproduced) are expected to fail so the
  // suite stays green; Playwright reports "expected to fail, but passed" once a
  // fix lands — then set status: fixed. REPRO_STRICT=1 (used by `repro check`)
  // disables this to see the raw result.
  _expectFailWhileUnfixed: [
    async ({}, use, testInfo) => {
      const slug = slugFromTestFile(testInfo.file);
      const status = reproStatus(slug);
      // Tests titled "control: …" are sanity checks that must pass regardless.
      const isControl = /^control\b/i.test(testInfo.title);
      if (
        !process.env.REPRO_STRICT &&
        !isControl &&
        status &&
        UNFIXED.has(status)
      ) {
        testInfo.fail(
          true,
          `repro:${slug} status is "${status}" (unfixed) — expected to fail`,
        );
      }
      await use();
    },
    { auto: true },
  ],
  _closeServers: [
    async ({}, use) => {
      await use();
      for (const handle of servers.values()) await (await handle).close();
      servers.clear();
    },
    { scope: "worker", auto: true },
  ],
  site: async ({}, use, testInfo) => {
    const slug = slugFromTestFile(testInfo.file);
    if (!servers.has(slug)) {
      servers.set(
        slug,
        ensureBuilt(slug).then(({ siteDir, basePath }) =>
          startStaticServer({ root: siteDir, basePath }),
        ),
      );
    }
    const handle = await servers.get(slug)!;
    await use({
      slug,
      dir: handle.server ? join(SITES_ROOT, `repro-${slug}`) : "",
      baseUrl: handle.baseUrl,
      url: (pagePath?: string) => handle.url(pagePath),
    });
  },
  pageProblems: async ({ page }, use) => {
    const problems: PageProblems = {
      console: [],
      pageErrors: [],
      failedRequests: [],
      all() {
        return [...this.console, ...this.pageErrors, ...this.failedRequests];
      },
    };
    page.on("console", (msg) => {
      if (msg.type() === "error")
        problems.console.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (err) =>
      problems.pageErrors.push(`pageerror: ${err.message}`),
    );
    page.on("requestfailed", (req) =>
      problems.failedRequests.push(
        `requestfailed: ${req.url()} (${req.failure()?.errorText})`,
      ),
    );
    page.on("response", (res) => {
      if (res.status() >= 400)
        problems.failedRequests.push(`HTTP ${res.status()}: ${res.url()}`);
    });
    await use(problems);
  },
});

export { expect, type Page };
