import { test, expect } from "../../helpers/repro-fixture";
// #2437: body text (from the first **bold**) leaked into the callout title.
test.describe("jackyzha0/quartz#2437 callout title stays the title", () => {
  test("nested callout with trailing double space after title", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    const titles = page.locator(".callout-title-inner");
    await expect(titles).toHaveCount(3);
    await expect(titles.nth(0)).toHaveText(/^\s*Dosage\s*$/);
    await expect(titles.nth(1)).toHaveText(/^\s*Dosage2\s*$/);
    await expect(page.locator(".callout-content strong").first()).toHaveText(
      "reactive",
    );
    expect(pageProblems.all()).toEqual([]);
  });
  test("commenter's nested callouts", async ({ page, site }) => {
    await page.goto(site.url("comment"));
    const titles = page.locator(".callout-title-inner");
    await expect(titles).toHaveText([
      "Marionette strings",
      "Using strings",
      "How does marionette work with instant abilities?",
    ]);
  });
});
