import { test, expect } from "../../helpers/repro-fixture";

// Roam syntax with ObsidianFlavoredMarkdown on (the default config): OFM parses `[[…]]` as
// wikilinks and CommonMark reads `__x__` as bold, so the roam plugin must rewrite its syntax
// before parsing (roam 1.1, textTransform).
test.describe("Repro: roam with ObsidianFlavoredMarkdown", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("/"));
  });

  const line = (page: import("@playwright/test").Page, n: number) =>
    page.locator("article p").filter({ hasText: new RegExp(`^${n} `) });

  test("{{[[TODO]]}} and {{[[DONE]]}} are checkboxes, not wikilinks", async ({
    page,
  }) => {
    await expect(
      line(page, 1).locator('input[type="checkbox"]'),
    ).not.toBeChecked();
    await expect(line(page, 2).locator('input[type="checkbox"]')).toBeChecked();
    await expect(line(page, 1).locator("a")).toHaveCount(0);
  });

  test("[[>]] is a blockquote", async ({ page }) => {
    await expect(page.locator("article blockquote")).toContainText(
      "3 a quoted line",
    );
  });

  test("__italic__ is italic, ^^x^^ a highlight, {{or:}} a select", async ({
    page,
  }) => {
    await expect(line(page, 4).locator("em")).toHaveText("italic");
    await expect(line(page, 4).locator(".text-highlight")).toHaveText("bright");
    await expect(line(page, 5).locator("select option")).toHaveText([
      "red",
      "green",
    ]);
  });

  test("inline code and ordinary wikilinks are left alone", async ({
    page,
  }) => {
    await expect(line(page, 6).locator("code")).toHaveText("{{[[TODO]]}}");
    await expect(line(page, 7).locator("a")).toHaveAttribute(
      "data-slug",
      "other",
    );
  });
});
