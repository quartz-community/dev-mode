import { test, expect } from "../../helpers/repro-fixture";

// folder-page generated a page for notes/ although notes/index.md exists (unlisted), and the
// generated page replaced the note (quartz-community/folder-page#23).
//
// Expected: /notes/ is the hand-written note, with the folder listing; the note stays unlisted.

test.describe("folder-page: an unlisted index note", () => {
  test("keeps its own page, with the folder listing", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("notes/"));
    await expect(page.locator("article")).toContainText(
      "Hand-written introduction to the notes folder.",
    );
    await expect(page.locator("h1.article-title")).toHaveText("My Notes Index");
    await expect(page.locator(".page-listing")).toContainText("Note A");
    expect(pageProblems.all()).toEqual([]);
  });

  test("stays out of the content index", async ({ page, site }) => {
    const index = await (
      await page.request.get(site.url("static/contentIndex.json"))
    ).json();
    expect(Object.keys(index)).not.toContain("notes/index");
    expect(Object.keys(index)).toContain("notes/a");
  });
});
