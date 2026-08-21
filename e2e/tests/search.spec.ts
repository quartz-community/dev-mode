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

    const results = page.locator(".search-layout");
    await expect(results).toBeVisible();

    const hasResults = await results.evaluate((el) => {
      return el.children.length > 0 || el.innerHTML.trim().length > 0;
    });
    expect(hasResults).toBe(true);
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
