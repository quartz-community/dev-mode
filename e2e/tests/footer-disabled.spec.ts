import { test, expect } from "@playwright/test";

test.use({ baseURL: "http://localhost:4176" });

test.describe("Footer Disabled (PR #2477)", () => {
  test("page loads and renders content", async ({ page }) => {
    await page.goto("/footer-disabled/");
    await expect(page.locator("article")).toBeVisible();
  });

  test("no <undefined> elements in DOM", async ({ page }) => {
    await page.goto("/footer-disabled/");

    const undefinedElements = await page.evaluate(() => {
      const all = document.querySelectorAll("*");
      const found: string[] = [];
      for (const el of all) {
        if (el.tagName.toLowerCase() === "undefined") {
          found.push(el.outerHTML.slice(0, 100));
        }
      }
      return found;
    });

    expect(undefinedElements).toHaveLength(0);
  });

  test("no footer element present", async ({ page }) => {
    await page.goto("/footer-disabled/");

    const footer = await page.$("footer");
    expect(footer).toBeNull();
  });
});
