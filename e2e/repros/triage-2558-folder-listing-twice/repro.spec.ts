import { test, expect } from "../../helpers/repro-fixture";
// #2558: folder/tag virtual pages rendered their listing twice.
test.describe("jackyzha0/quartz#2558 virtual pages render one listing", () => {
  for (const p of ["myfolder/", "tags/demo"]) {
    test(`${p} has exactly one page listing`, async ({
      page,
      site,
      pageProblems,
    }) => {
      await page.goto(site.url(p));
      await expect(page.locator(".page-listing")).toHaveCount(1);
      await expect(page.locator(".center article")).toHaveCount(1);
      expect(pageProblems.all()).toEqual([]);
    });
  }
  test("after SPA navigation too", async ({ page, site }) => {
    await page.goto(site.url("/"));
    await page.locator('article a.internal[href*="tags/demo"]').first().click();
    await page.waitForURL(/tags\/demo/);
    await expect(page.locator(".page-listing")).toHaveCount(1);
  });
});
