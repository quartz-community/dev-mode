import { test, expect } from "../../helpers/repro-fixture";

// Example repro (fixed upstream): bold text in a nested callout body used to
// leak into the callout title. Asserts the EXPECTED behaviour, so it passes now.

test.describe("Callout body text leaks into title (#2437)", () => {
  test("nested callout keeps bold body text out of the title", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    const callout = page.locator('.callout[data-callout="info"]');
    await expect(callout).toBeVisible();
    await expect(callout.locator(".callout-title-inner")).toHaveText("Dosage");
    await expect(callout.locator(".callout-content")).toContainText("reactive");
    expect(pageProblems.all()).toEqual([]);
  });
});
