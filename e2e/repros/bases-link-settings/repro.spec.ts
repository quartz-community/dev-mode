import { test, expect, type Page } from "../../helpers/repro-fixture";

// Bases render their links when the page is rendered, after the links built-in has processed the
// note's own links, so they ignored `configuration.links`: external links had no external-link
// icon and always opened in a new tab, and links from wikilink properties had no data-slug (no
// popover, full page loads instead of SPA navigation).
// Expected: links in a base look and behave like the note's own links.

async function expectLikeTheSite(page: Page, scope: string) {
  const externals = page.locator(`${scope} a.external`);
  await expect(externals).toHaveCount(2);
  for (const link of await externals.all()) {
    await expect(link.locator("svg.external-icon")).toHaveCount(1);
    await expect(link).not.toHaveAttribute("target", "_blank");
  }
  await expect(
    page.locator(`${scope} a.internal:has-text("Two")`).first(),
  ).toHaveAttribute("data-slug", "books/two");
}

test.describe("links in bases follow configuration.links", () => {
  test("control: the note's own links follow the settings", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    const own = page.locator("article p a.external");
    await expect(own.locator("svg.external-icon")).toHaveCount(1);
    await expect(own).not.toHaveAttribute("target", "_blank");
    await expect(page.locator("article p a.internal")).toHaveAttribute(
      "data-slug",
      "books/one",
    );
    expect(pageProblems.all()).toEqual([]);
  });

  test("an embedded base", async ({ page, site }) => {
    await page.goto(site.url("/"));
    await expectLikeTheSite(page, "article .bases-inline");
  });

  test("the .base page", async ({ page, site }) => {
    await page.goto(site.url("shelf.base"));
    await expectLikeTheSite(page, ".bases-page .bases-table");
  });
});
