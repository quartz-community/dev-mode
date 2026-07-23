import { test, expect } from "@playwright/test";

const EXPECTED_MISSING_RESOURCES = ["contentIndex.json"];

function isExpected404(url: string): boolean {
  return EXPECTED_MISSING_RESOURCES.some((r) => url.includes(r));
}

test.describe("Base URL / SPA Navigation (#2420, #2462)", () => {
  test("all internal links resolve to /test-base/-prefixed URLs", async ({
    page,
  }) => {
    await page.goto("/test-base/");

    const links = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => {
          try {
            const url = new URL(href);
            return url.origin === window.location.origin;
          } catch {
            return false;
          }
        }),
    );

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const linkPath = new URL(link).pathname;
      expect(linkPath).toMatch(/^\/test-base\//);
    }
  });

  test("SPA navigate across directories preserves correct URLs", async ({
    page,
  }) => {
    const responses404: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 404 && !isExpected404(res.url()))
        responses404.push(res.url());
    });

    await page.goto("/test-base/docs/getting-started");

    await page.click('a[href*="features/callouts"]');
    await page.waitForURL("**/test-base/features/callouts");

    await expect(page.locator("h1")).toContainText("Callouts");
    expect(responses404).toEqual([]);
  });

  test("chained SPA navigation: home -> docs -> features -> deep", async ({
    page,
  }) => {
    await page.goto("/test-base/");

    await page.click('a[href*="docs/getting-started"]');
    await page.waitForURL("**/test-base/docs/getting-started");

    await page.click('a[href*="features/callouts"]');
    await page.waitForURL("**/test-base/features/callouts");

    await page.click('a[href*="deep/nested/page"]');
    await page.waitForURL("**/test-base/deep/nested/page");

    const links = await page
      .locator("a.internal")
      .evaluateAll((anchors) =>
        anchors.map((a) => (a as HTMLAnchorElement).href),
      );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const linkPath = new URL(link).pathname;
      expect(linkPath).toMatch(/^\/test-base\//);
    }
  });

  test("SPA-navigated page matches full-page-load content", async ({
    page,
  }) => {
    await page.goto("/test-base/features/callouts");
    const fullLoadTitle = await page.locator("h1").textContent();
    const fullLoadArticle = await page.locator("article").textContent();

    await page.goto("/test-base/");
    await page.click('a[href*="features/callouts"]');
    await page.waitForURL("**/test-base/features/callouts");
    const spaTitle = await page.locator("h1").textContent();
    const spaArticle = await page.locator("article").textContent();

    expect(spaTitle).toBe(fullLoadTitle);
    expect(spaArticle).toBe(fullLoadArticle);
  });

  test("browser back/forward preserves /test-base/ prefix", async ({
    page,
  }) => {
    await page.goto("/test-base/");
    await page.click('a[href*="docs/getting-started"]');
    await page.waitForURL("**/test-base/docs/getting-started");

    await page.goBack();
    await page.waitForURL("**/test-base/");

    await page.goForward();
    await page.waitForURL("**/test-base/docs/getting-started");
  });

  test("no 404 responses during SPA navigation chain", async ({ page }) => {
    const responses404: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 404 && !isExpected404(res.url()))
        responses404.push(res.url());
    });

    await page.goto("/test-base/");
    await page.click('a[href*="docs/getting-started"]');
    await page.waitForURL("**/test-base/docs/getting-started");
    await page.click('a[href*="features/callouts"]');
    await page.waitForURL("**/test-base/features/callouts");

    expect(responses404).toEqual([]);
  });
});
