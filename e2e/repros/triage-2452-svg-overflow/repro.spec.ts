import { test, expect } from "../../helpers/repro-fixture";
// #2452: an embedded wide SVG (<object>) is wider than the article.
test.describe("jackyzha0/quartz#2452 SVG embed fits its container", () => {
  test("wide SVG does not overflow the article", async ({ page, site }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(site.url("/"));
    const article = await page.locator("article").boundingBox();
    const obj = page.locator('article object[data*="wide.svg"]').first();
    await expect(obj).toBeVisible();
    const box = await obj.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(article!.width + 1);
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(docOverflow).toBe(false);
  });
});
