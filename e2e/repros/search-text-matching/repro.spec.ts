import { test, expect, type Page } from "../../helpers/repro-fixture";
// search: how a query matches and shows text — diacritics (configuration.slugs.stripDiacritics),
// diacritic-folded tags, typographic apostrophes, and excerpts of text with HTML characters.

async function search(page: Page, query: string) {
  await page.locator("button.search-button").first().click();
  const bar = page.locator("input.search-bar").first();
  await expect(bar).toBeFocused();
  await bar.fill(query);
  const results = page.locator(".results-container").first();
  await expect(results.locator(".result-card").first()).toBeVisible();
  return results;
}

const cards = (results: ReturnType<Page["locator"]>) =>
  results.locator(".result-card:not(.no-match)");

test.describe("search text matching (stripDiacritics: true)", () => {
  test("query creme finds and highlights Crème", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url());
    const results = await search(page, "creme");
    await expect(cards(results)).toHaveCount(1);
    await expect(cards(results).first()).toHaveAttribute("href", "/desserts");
    await expect(
      cards(results).first().locator(".card-description .highlight"),
    ).toHaveText(["Crème"]);
    expect(pageProblems.all()).toEqual([]);
  });

  for (const query of ["#cafe", "#café"]) {
    test(`${query} finds the page tagged café`, async ({ page, site }) => {
      await page.goto(site.url());
      const results = await search(page, query);
      await expect(cards(results)).toHaveCount(1);
      await expect(cards(results).first()).toHaveAttribute("href", "/desserts");
      await expect(cards(results).first().locator(".match-tag")).toHaveText(
        "#cafe",
      );
    });
  }

  test("query don't highlights the typeset don’t", async ({ page, site }) => {
    await page.goto(site.url());
    const results = await search(page, "don't");
    await expect(cards(results)).toHaveCount(1);
    await expect(
      cards(results).first().locator(".card-description .highlight"),
    ).toHaveText(["don’t"]);
  });

  test('an excerpt of "hello" & <br> shows that text, not entities or markup', async ({
    page,
    site,
  }) => {
    await page.goto(site.url("plain"));
    const shown = (
      await page.locator("article p").first().textContent()
    )?.trim();
    expect(shown).toBe("Some “hello” & <br> text.");

    const results = await search(page, "hello");
    const excerpt = cards(results).first().locator(".card-description");
    await expect(excerpt.locator(".highlight")).toHaveText(["hello"]);
    // the text, not a <br> element
    await expect(excerpt.locator("br")).toHaveCount(0);
    const text = (await excerpt.textContent()) ?? "";
    expect(text).toContain("Some “hello” & <br>");
    expect(text).not.toMatch(/&(amp|quot|lt|gt|#\d+);/);
  });
});
