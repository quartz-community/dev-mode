import { test, expect } from "../../helpers/repro-fixture";

test.describe("SPA navigation through a folder redirect (base path)", () => {
  test("links on the redirected folder page resolve against the final URL", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await page.locator("#to-folder").click();
    await expect(page).toHaveURL(/\/spa-base\/notes\/$/);
    const link = page
      .locator(".page-listing a", { hasText: "First note" })
      .first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveTitle(/First note/);
    await expect(page.locator("article")).toContainText(
      "Hello from the first note.",
    );
    expect(pageProblems.all()).toEqual([]);
  });
});
