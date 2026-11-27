import { test, expect } from "../../helpers/repro-fixture";

// TalionOak/Carvalho: under a base path, inline tag links climbed one folder too many
// (transformLink, quartz-community/utils#29) and left the site.
//
// Expected: every inline tag link resolves under /sub, from any folder depth.

test.describe("inline tag links under a base path", () => {
  // one test for every depth: at the root and one folder down the extra `..` happened to cancel
  test("tag links stay under /sub from every folder depth", async ({
    page,
    site,
    pageProblems,
  }) => {
    for (const [slug, tags] of [
      ["", ["foo"]],
      ["folder/nested", ["foo"]],
      ["folder/deeper/note", ["foo", "bar/baz"]],
    ] as const) {
      await page.goto(site.url(slug));
      const links = page.locator("article a.tag-link");
      await expect(links).toHaveCount(tags.length);
      const resolved = await links.evaluateAll((as) =>
        as.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
      );
      expect(resolved, `tag links on /${slug}`).toEqual(
        tags.map((t) => `/sub/tags/${t}`),
      );
      for (const path of resolved) {
        expect(
          (await page.request.get(new URL(path, site.url("")).href)).status(),
        ).toBe(200);
      }
    }
    expect(pageProblems.all()).toEqual([]);
  });

  test("clicking a tag link from a nested note opens the tag page", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("folder/deeper/note"));
    await page.locator("article a.tag-link", { hasText: "foo" }).click();
    await page.waitForURL(/\/sub\/tags\/foo$/, { timeout: 10_000 });
    await expect(page).toHaveTitle(/foo/);
    await expect(page.locator("body")).toContainText("Deep note");
  });
});
