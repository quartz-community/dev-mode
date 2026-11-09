import { test, expect } from "../../helpers/repro-fixture";

// A footnote whose reference sits in a table cell past the delimiter row's column count.
// GFM (and Obsidian) hide that cell; Obsidian 1.15.0 still renders the footnote, numbered where
// the reference is written (remark-obsidian parity goldens, triage/nightly2/np-S1, -S3, -S5).

test.describe("Repro: ofm-table-surplus-cell-footnote", () => {
  test("control: the surplus cells stay hidden", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    const article = page.locator("article");
    await expect(
      article.locator("table tbody tr").first().locator("td"),
    ).toHaveCount(1);
    await expect(article.locator("table")).not.toContainText("hidden");
    await expect(article.locator("table")).not.toContainText("again");
    expect(pageProblems.all()).toEqual([]);
  });

  test("footnotes referenced in hidden cells render, numbered in source order", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const items = page.locator("article section.footnotes li");
    await expect(items).toHaveText([
      /Referenced only in a hidden cell\./,
      /inline in a hidden cell/,
      /Referenced in a hidden cell and in the text\./,
      /Referenced only in the text\./,
    ]);
    // `[^both]` is footnote 3 (first referenced in the hidden cell), `[^last]` footnote 4.
    await expect(page.locator("article p sup a[data-footnote-ref]")).toHaveText(
      ["3", "4"],
    );
  });

  test("every back-link points at a reference on the page", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const targets = await page
      .locator("article section.footnotes a[data-footnote-backref]")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("href") ?? ""),
      );
    // Only [^both] and [^last] have a visible reference, once each.
    expect(targets).toHaveLength(2);
    for (const target of targets) {
      await expect(
        page.locator(`[id="${decodeURIComponent(target.slice(1))}"]`),
      ).toBeVisible();
    }
  });
});
