import { test, expect, type Page } from "../../helpers/repro-fixture";

// A base inside a transcluded note (an inline ```base block and a ![[Shelf.base]] embed)
// rendered the host page's base with the same index, or nothing when the host had none.
// Obsidian 1.15.1 (obsidian-bases-probe) renders the transcluded note's own bases, and `this` in
// them is that note (Source), not the host.

async function transcludedTables(page: Page) {
  const tables = page.locator("article .transclude .bases-table");
  await expect(tables).toHaveCount(2);
  return tables;
}

test.describe("bases in a transcluded note", () => {
  test("control: Source's own page renders its bases, with this = Source", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("source"));
    const tables = page.locator("article .bases-table");
    await expect(tables).toHaveCount(2);
    await expect(tables.first().locator("tbody tr").first()).toContainText(
      "Source",
    );
    expect(pageProblems.all()).toEqual([]);
  });

  test("a host with its own base shows its base and Source's, each its own", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    // the host's list, not a table
    await expect(
      page.locator("article > div .bases-list-item").first(),
    ).toBeAttached();
    const tables = await transcludedTables(page);
    for (const index of [0, 1]) {
      await expect(tables.nth(index).locator("thead th")).toHaveText([
        "file name",
        "me",
      ]);
      await expect(
        tables.nth(index).locator("tbody tr td:nth-child(2)"),
      ).toHaveText(["Source", "Source"]);
    }
  });

  test("a host without bases shows Source's bases", async ({ page, site }) => {
    await page.goto(site.url("plain"));
    await transcludedTables(page);
  });
});
