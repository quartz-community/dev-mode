import { test, expect } from "../../helpers/repro-fixture";

// #2576: a folder holding only virtual pages (a `.base` or `.canvas` file, rendered by
// bases-page / canvas-page) got no folder page, so going up a level was a 404.
test.describe("jackyzha0/quartz#2576 folders of virtual pages get a folder page", () => {
  test("control: a folder with a markdown note has a folder page", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("notes/"));
    await expect(page.locator(".page-listing")).toBeVisible();
    expect(pageProblems.all()).toEqual([]);
  });

  const cases: Array<[folder: string, entry: string]> = [
    ["trips/", "trips/map.base"],
    ["projects/", "projects/2026"],
    ["projects/2026/", "projects/2026/board.base"],
    ["boards/", "boards/plan.canvas"],
    // a folder with a note and a base lists both
    ["mixed/", "mixed/board.base"],
    ["mixed/", "mixed/note"],
  ];
  for (const [folder, entry] of cases) {
    test(`${folder} has a folder page listing ${entry}`, async ({
      page,
      site,
      pageProblems,
    }) => {
      const response = await page.goto(site.url(folder));
      expect(response?.status()).toBe(200);
      await expect(page.locator(".page-listing")).toBeVisible();
      await expect(
        page.locator(`.page-listing a[href*="${entry.split("/").pop()}"]`),
      ).not.toHaveCount(0);
      expect(pageProblems.all()).toEqual([]);
    });
  }
});
