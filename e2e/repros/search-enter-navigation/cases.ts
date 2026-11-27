import { test, expect } from "../../helpers/repro-fixture";

/**
 * Keyboard navigation of search results, shared by search-enter-navigation (site at the root)
 * and search-enter-navigation-base (`baseUrl: localhost/sub`): type a query, ArrowDown, Enter
 * opens the focused result through the SPA router (no full page load) and closes the overlay.
 */
export function searchEnterCases(slug: string) {
  test.use({ reproSlug: slug });

  test.describe(`search keyboard navigation (${slug})`, () => {
    test("ArrowDown then Enter opens the second result without a reload", async ({
      page,
      site,
      pageProblems,
    }) => {
      await page.goto(site.url());
      await expect(page).toHaveTitle(/^Home\b/);
      await page.evaluate(
        () => ((window as unknown as { __marker: number }).__marker = 1),
      );

      await page.locator("button.search-button").first().click();
      const container = page.locator(".search-container").first();
      await expect(container).toHaveClass(/active/);
      const bar = page.locator("input.search-bar").first();
      await bar.fill("zebra");
      const cards = page.locator(
        ".results-container .result-card:not(.no-match)",
      );
      await expect(cards).toHaveCount(2);
      // The first result is focused; ArrowDown moves to the second.
      await expect(cards.nth(0)).toHaveClass(/focus/);
      await bar.press("ArrowDown");
      await expect(cards.nth(1)).toHaveClass(/focus/);
      await expect(cards.nth(0)).not.toHaveClass(/focus/);
      const href = (await cards.nth(1).getAttribute("href"))!;
      expect(href).toMatch(
        new RegExp(
          `^${new URL(site.baseUrl).pathname.replace(/\/$/, "")}/notes/`,
        ),
      );
      const title = (await cards.nth(1).locator(".card-title").textContent())!;

      await bar.press("Enter");
      await expect(page).toHaveURL(new URL(href, site.baseUrl).toString());
      await expect(page).toHaveTitle(new RegExp(`^${title}\\b`));
      await expect(
        page.locator("article h1, .article-title").first(),
      ).toHaveText(title);
      expect(
        await page.evaluate(
          () => (window as unknown as { __marker?: number }).__marker,
        ),
      ).toBe(1);
      await expect(container).not.toHaveClass(/active/);
      await expect(bar).toBeHidden();
      await expect(
        page.locator("button.search-button").first(),
      ).toHaveAttribute("aria-expanded", "false");
      expect(pageProblems.all()).toEqual([]);
    });
  });
}
