import { test, expect } from "../../helpers/repro-fixture";

// quartz.config.default.yaml excludes reader-mode on folder and tag pages via
// `layout.byPageType.<type>.exclude: [reader-mode]`, but plugin sources are npm
// specifiers ("@quartz-community/reader-mode") and the loader compared the
// exclude list against the full specifier, so nothing was ever excluded.

test.describe("byPageType.exclude with npm plugin sources", () => {
  test("reader-mode is excluded on tag pages", async ({ page, site }) => {
    await page.goto(site.url("tags/demo"));
    await expect(page.locator(".page-header")).toBeVisible();
    await expect(page.locator(".readermode")).toHaveCount(0);
  });

  test("reader-mode is excluded on folder pages", async ({ page, site }) => {
    await page.goto(site.url("notes/"));
    await expect(page.locator(".page-header")).toBeVisible();
    await expect(page.locator(".readermode")).toHaveCount(0);
  });

  test("control: reader-mode renders on content pages", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("notes/page"));
    await expect(page.locator(".readermode")).toHaveCount(1);
  });
});
