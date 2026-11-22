import { test, expect } from "../../helpers/repro-fixture";

// On phones the page is one grid column. An `auto` track grows to its widest item's min-content,
// so one too-wide item in the header row (a long page title, or a theme's chrome) widened the
// whole page past the screen, and every page scrolled sideways.
test.describe("phone layout: wide header chrome doesn't widen the page", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("the page column stays within the screen", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await expect(page.locator("article")).toBeVisible();
    const m = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      center: Math.round(
        document.querySelector(".center")!.getBoundingClientRect().width,
      ),
      title: Math.round(
        document.querySelector(".page-title")!.getBoundingClientRect().right,
      ),
    }));
    expect(m.center).toBeLessThanOrEqual(m.viewport);
    expect(m.title).toBeLessThanOrEqual(m.viewport);
    expect(m.scroll).toBe(m.viewport);
    expect(pageProblems.all()).toEqual([]);
  });
});
