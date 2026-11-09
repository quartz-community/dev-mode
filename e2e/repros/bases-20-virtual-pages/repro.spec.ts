import { test, expect } from "../../helpers/repro-fixture";

// Quartz's generated pages (404, the tags index and tag pages, folder listings)
// reach the plugin with a synthetic `<slug>.md` relativePath, but they are not
// notes: Obsidian Bases never lists them.
async function rowNames(
  page: import("@playwright/test").Page,
  table: number,
): Promise<string[]> {
  const names = await page
    .locator("article .bases-inline")
    .nth(table)
    .locator("table.bases-table tbody tr td:first-child")
    .allTextContents();
  return names.map((n) => n.trim()).sort();
}

test.describe("virtual pages are not notes in base views (bases-page#20)", () => {
  test("a root-folder base lists only real root notes (no 404)", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    expect(await rowNames(page, 0)).toEqual(["Other"]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("an all-notes base lists no tag, folder or 404 pages", async ({
    page,
    site,
  }) => {
    await page.goto(site.url(""));
    expect(await rowNames(page, 1)).toEqual(["Deep", "Other"]);
  });

  test("control: the generated pages exist on the site", async ({
    page,
    site,
  }) => {
    expect((await page.request.get(site.url("tags"))).status()).toBe(200);
    expect((await page.request.get(site.url("tags/demo"))).status()).toBe(200);
    expect((await page.request.get(site.url("notes/"))).status()).toBe(200);
  });
});
