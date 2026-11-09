import { test, expect } from "../../helpers/repro-fixture";

// With folder-page disabled, a hand-written folder index.md still renders as a content page.
test.describe("folder index.md renders when folder-page is disabled", () => {
  test("hand-written folder index is served", async ({
    page,
    site,
    pageProblems,
  }) => {
    const response = await page.goto(site.url("guides/"));
    expect(response?.status()).toBe(200);
    await expect(page.locator("article")).toContainText(
      "A hand-written folder index.",
    );
    expect(pageProblems.all()).toEqual([]);
  });

  test("control: a note in the folder is served", async ({ page, site }) => {
    expect((await page.request.get(site.url("guides/first"))).status()).toBe(
      200,
    );
  });
});
