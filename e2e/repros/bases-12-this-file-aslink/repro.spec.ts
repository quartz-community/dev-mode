import { test, expect } from "../../helpers/repro-fixture";

// People.base is embedded in people/Alice.md and people/Bob.md. Its filter uses
// this.file.asLink(), which must resolve against the note that embeds the base.
// index.md links to both people, so it matches via file.links on both pages.
async function rowNames(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  const names = await page
    .locator("article .bases-inline table.bases-table tbody tr td:first-child")
    .allTextContents();
  return names.map((n) => n.trim()).sort();
}

test.describe("this.file.asLink() in an embedded base (bases-page#12)", () => {
  test("Alice's page lists the guides she authored (scalar and list authors)", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("people/alice"));
    expect(await rowNames(page)).toEqual([
      "Joint Guide",
      "Solo Guide",
      "index",
    ]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("Bob's page lists only the note linking to him", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("people/bob"));
    expect(await rowNames(page)).toEqual(["Bob Notes", "index"]);
  });
});
