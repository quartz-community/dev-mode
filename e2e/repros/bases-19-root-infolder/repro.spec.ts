import { test, expect } from "../../helpers/repro-fixture";

// index.md sits at the content root, so this.file.folder is the root and
// file.inFolder(this.file.folder) is true for every note (as in Obsidian).
test.describe("file.inFolder(this.file.folder) in a root note (bases-page#19)", () => {
  test("lists every note, including notes in subfolders", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    const names = (
      await page
        .locator(
          "article .bases-inline table.bases-table tbody tr td:first-child",
        )
        .allTextContents()
    ).map((n) => n.trim());
    expect(names).toContain("Other");
    expect(names).toContain("Deep");
    await expect(
      page.locator("article .bases-inline .bases-view > .bases-empty"),
    ).toHaveCount(0);
    expect(pageProblems.all()).toEqual([]);
  });
});
