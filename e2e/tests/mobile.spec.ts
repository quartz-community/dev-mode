import { test, expect } from "@playwright/test";

const BASE = "/bug-repro";
const ORIGIN = "http://localhost:4175";

test.describe("Mobile Viewport Rendering", () => {
  test.use({
    baseURL: ORIGIN,
    viewport: { width: 375, height: 667 },
  });

  test("homepage renders correctly at mobile width", async ({ page }) => {
    await page.goto(`${BASE}/`);

    const article = page.locator("article");
    await expect(article).toBeVisible();

    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Home");
  });

  test("no horizontal overflow at mobile width", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      return {
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        htmlScrollWidth: html.scrollWidth,
        htmlClientWidth: html.clientWidth,
      };
    });

    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(
      overflow.bodyClientWidth,
    );
    expect(overflow.htmlScrollWidth).toBeLessThanOrEqual(
      overflow.htmlClientWidth,
    );
  });

  test("content text is readable at mobile size", async ({ page }) => {
    await page.goto(`${BASE}/`);

    const fontSize = await page.locator("article").evaluate((el) => {
      const style = window.getComputedStyle(el);
      return parseFloat(style.fontSize);
    });

    expect(fontSize).toBeGreaterThanOrEqual(12);
  });

  test("navigation elements are accessible on mobile", async ({ page }) => {
    await page.goto(`${BASE}/`);

    const pageTitle = page.locator("h2.page-title a");
    await expect(pageTitle).toBeVisible();

    const searchButton = page.locator("button.search-button");
    await expect(searchButton).toBeVisible();

    const box = await searchButton.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });
});
