/**
 * Shared Playwright `test` for every e2e suite (fixture suites import it directly,
 * repro-fixture.ts extends it).
 *
 * Opt-in browser JS coverage: with `E2E_JS_COVERAGE=<dir>` set, each test's `page`
 * records V8 precise coverage (Chromium only, `resetOnNavigation: false`, so full
 * navigations and SPA navigations are both kept) and writes it to
 * `<dir>/<worker>-<test>.json` when the test ends. Script sources are deduplicated
 * into `<dir>/sources/<sha256>.js`; dumps reference them by `sourceHash`. Only
 * scripts served by the local test servers (127.0.0.1 / localhost) are kept.
 *
 * Without the env var the `page` fixture is passed through untouched.
 * `just e2e-coverage` runs the suites with it and builds the report
 * (scripts/e2e-coverage-report.ts).
 */
import { test as base, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface CoverageDumpEntry {
  url: string;
  sourceHash: string;
  functions: {
    functionName: string;
    isBlockCoverage: boolean;
    ranges: { startOffset: number; endOffset: number; count: number }[];
  }[];
}

export interface CoverageDump {
  test: string;
  file: string;
  entries: CoverageDumpEntry[];
}

function isLocalScript(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return (
      protocol === "http:" &&
      (hostname === "127.0.0.1" || hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export const test = base.extend({
  page: async ({ page, browserName }, use, testInfo) => {
    const dir = process.env.E2E_JS_COVERAGE;
    if (!dir || browserName !== "chromium") {
      await use(page);
      return;
    }
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    let raw: Awaited<ReturnType<typeof page.coverage.stopJSCoverage>>;
    try {
      raw = await page.coverage.stopJSCoverage();
    } catch {
      return; // page/context already closed (e.g. a crashed test)
    }
    const outDir = resolve(dir);
    const sourcesDir = join(outDir, "sources");
    mkdirSync(sourcesDir, { recursive: true });
    const entries: CoverageDumpEntry[] = [];
    for (const entry of raw) {
      if (!isLocalScript(entry.url) || entry.source === undefined) continue;
      const sourceHash = createHash("sha256")
        .update(entry.source)
        .digest("hex");
      const sourcePath = join(sourcesDir, `${sourceHash}.js`);
      if (!existsSync(sourcePath)) writeFileSync(sourcePath, entry.source);
      entries.push({
        url: entry.url,
        sourceHash,
        functions: entry.functions,
      });
    }
    const id = createHash("sha256")
      .update(
        `${testInfo.file}\0${testInfo.titlePath.join("\0")}\0${testInfo.repeatEachIndex}\0${testInfo.retry}`,
      )
      .digest("hex")
      .slice(0, 16);
    const dump: CoverageDump = {
      test: testInfo.titlePath.join(" › "),
      file: testInfo.file,
      entries,
    };
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(dump));
  },
});

export { expect, type Page };
