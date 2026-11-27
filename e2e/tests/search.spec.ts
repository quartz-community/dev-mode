import { test, expect } from "@playwright/test";

const BASE = "/bug-repro";
const ORIGIN = "http://localhost:4175";

test.describe("Search Functionality", () => {
  test.use({ baseURL: ORIGIN });

  test("search button is visible on the page", async ({ page }) => {
    await page.goto(`${BASE}/`);

    const searchButton = page.locator("button.search-button");
    await expect(searchButton).toBeVisible();
    await expect(searchButton).toHaveAttribute("aria-label", "Search");
  });

  test("clicking search button opens the search overlay", async ({ page }) => {
    await page.goto(`${BASE}/`);

    const searchButton = page.locator("button.search-button");
    await expect(searchButton).toHaveAttribute("aria-expanded", "false");

    await searchButton.click();
    await page.waitForTimeout(300);

    const searchBar = page.locator("input.search-bar");
    await expect(searchBar).toBeVisible();
    await expect(searchBar).toHaveAttribute(
      "placeholder",
      "Search for something...",
    );
  });

  test("typing a query produces search results", async ({ page }) => {
    await page.goto(`${BASE}/`);

    const searchButton = page.locator("button.search-button");
    await searchButton.click();
    await page.waitForTimeout(300);

    const searchBar = page.locator("input.search-bar");
    await expect(searchBar).toBeVisible();

    await searchBar.fill("Getting Started");
    await page.waitForTimeout(500);

    await expect(page.locator(".search-layout")).toBeVisible();
    // `.results-container` always exists; a match is a `.result-card` that is not `.no-match`.
    const cards = page.locator(
      ".results-container .result-card:not(.no-match)",
    );
    await expect(cards.first()).toBeVisible();
    await expect(page.locator(".results-container .no-match")).toHaveCount(0);
    await expect(cards.first()).toHaveAttribute(
      "href",
      new RegExp(`^${BASE}/docs/getting-started$`),
    );
    await expect(cards.first().locator(".card-title")).toHaveText(
      /getting started/i,
    );
  });

  test("search can be dismissed", async ({ page }) => {
    await page.goto(`${BASE}/`);

    const searchButton = page.locator("button.search-button");
    await searchButton.click();
    await page.waitForTimeout(300);

    const searchBar = page.locator("input.search-bar");
    await expect(searchBar).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(searchBar).not.toBeVisible();
  });
});
