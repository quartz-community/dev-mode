import { test, expect } from "../../helpers/repro-fixture";

// #2574: GoatCounter counts the landing page in count.js onload AND registers
// the nav listener there; in production builds component scripts are imported
// in parallel before the router, so a cached count.js can load before the
// initial nav → landing page counted twice. count.js is replaced by a local
// stub (content/gc-stub.js) that records count() calls.

test.describe("Repro for jackyzha0/quartz#2574", () => {
  test("each page view is counted exactly once (cached script)", async ({
    page,
    site,
  }) => {
    const results: number[] = [];
    // first load warms the HTTP cache for gc-stub.js
    await page.goto(site.url("/"));
    await page.waitForFunction(() => (window as any).__gcCounts?.length > 0);
    await page.waitForTimeout(300);
    results.push(await page.evaluate(() => (window as any).__gcCounts.length));
    for (let i = 0; i < 5; i++) {
      await page.goto(site.url(i % 2 ? "/" : "other"));
      await page.waitForFunction(() => (window as any).__gcCounts?.length > 0);
      await page.waitForTimeout(300);
      results.push(
        await page.evaluate(() => (window as any).__gcCounts.length),
      );
    }
    expect(results).toEqual([1, 1, 1, 1, 1, 1]);
  });

  test("control: SPA navigation adds exactly one count", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await page.waitForFunction(() => (window as any).__gcCounts?.length > 0);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => (window as any).__gcCounts.length);
    await page.locator('article a.internal[href*="other"]').first().click();
    await page.waitForURL(/other/);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => (window as any).__gcCounts.length);
    expect(after - before).toBe(1);
  });
});
