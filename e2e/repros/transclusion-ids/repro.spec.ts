import { test, expect } from "../../helpers/repro-fixture";

// Transcluded content copied the transcluded page's ids: headings and footnotes shared ids with
// the host and with each other, so the host's footnote [1] jumped to the transcluded note's
// footnote and a [[#Details]] link inside the transclusion to the host's heading. A heading
// transclusion also brought along the page's whole footnotes section.
// Expected (as Obsidian resolves each embed on its own): ids are unique on the page, and links
// inside a transclusion go to its own elements.

test.describe("ids in transcluded content", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("/"));
  });

  test("control: renders the transclusions", async ({ page, pageProblems }) => {
    await expect(page.locator("article .transclude")).toHaveCount(2);
    expect(pageProblems.all()).toEqual([]);
  });

  test("every id on the page is unique", async ({ page }) => {
    const duplicates = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const el of document.querySelectorAll("[id]"))
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
    });
    expect(duplicates).toEqual([]);
  });

  // a link goes to the first element on the page with its id
  const firstWithId = (id: string) => `xpath=(//*[@id="${id}"])[1]`;

  test("the host's footnote reference goes to the host's footnote", async ({
    page,
  }) => {
    const ref = page
      .locator("article .markdown-rendered > p a[data-footnote-ref]")
      .first();
    const target = (await ref.getAttribute("href"))!;
    await expect(page.locator(firstWithId(target.slice(1)))).toContainText(
      "Host footnote.",
    );
  });

  test("links inside a transclusion go to its own heading and footnotes", async ({
    page,
  }) => {
    const full = page.locator("article .transclude").first();
    const heading = (await full
      .locator('a:has-text("the details")')
      .getAttribute("href"))!;
    const headingTarget = page.locator(firstWithId(heading.slice(1)));
    await expect(headingTarget).toHaveText(/Details/);
    await expect(headingTarget).not.toContainText("Host details");
    expect(
      await headingTarget.evaluate((el) => !!el.closest(".transclude")),
    ).toBe(true);
    const footnote = (await full
      .locator("a[data-footnote-ref]")
      .first()
      .getAttribute("href"))!;
    await expect(page.locator(firstWithId(footnote.slice(1)))).toContainText(
      "Overview footnote.",
    );
  });

  test("a heading transclusion holds only its own footnotes", async ({
    page,
  }) => {
    const section = page.locator("article .transclude").nth(1);
    await expect(section).toContainText("Overview footnote.");
    await expect(section).not.toContainText("Details footnote.");
    // [[#Details]] points outside the slice: to the Details heading on the source page
    await expect(section.locator('a:has-text("the details")')).toHaveAttribute(
      "href",
      /source#details$/,
    );
  });
});
