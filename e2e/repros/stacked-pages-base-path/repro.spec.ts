import { test, expect } from "../../helpers/repro-fixture";

// stacked-pages kept each tab's slug with the site's base path in it, and navigateToTab added the
// base path again: under /sub a tab opened /sub/sub/<page>, a 404.
//
// Expected: clicking a tab opens the page under the base path once.

test.describe("stacked-pages: tabs under a base path", () => {
  test("clicking the first tab opens /sub/first, not /sub/sub/first", async ({
    page,
    site,
    pageProblems,
  }) => {
    expect(new URL(site.baseUrl).pathname).toBe("/sub");
    const doubled: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.includes("/sub/sub/"))
        doubled.push(req.url());
    });

    await page.goto(site.url("first"));
    await expect(page.locator("article")).toContainText("The first page.");
    await page.locator("article a.internal", { hasText: "Second" }).click();
    await page.waitForURL(/\/sub\/second$/);
    await expect(page.locator("article")).toContainText("The second page.");

    const tabs = page.locator("#stacked-pages-container .binder-tab");
    await expect(tabs).toHaveCount(2);
    await tabs.filter({ hasText: "First" }).click();

    await expect(page.locator("article")).toContainText("The first page.");
    expect(new URL(page.url()).pathname).toBe("/sub/first");
    expect(doubled, "requests with the base path twice").toEqual([]);
    // the SPA router may answer from the browser cache (no response event), so request the URL
    // the tab opened again
    expect((await page.request.get(page.url())).status()).toBe(200);
    expect(pageProblems.all()).toEqual([]);
  });
});
