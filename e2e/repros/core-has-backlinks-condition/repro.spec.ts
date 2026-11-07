import { test, expect } from "../../helpers/repro-fixture";

// repos/quartz/quartz/plugins/loader/conditions.ts: "has-backlinks" checks
// fileData.backlinks, but no plugin or core code ever writes that key
// (`just catalog who-writes backlinks` → none). Backlinks are computed at
// render time from allFiles[].links, so the condition is always false and a
// component gated on it never renders.

test.describe("has-backlinks condition", () => {
  test("Backlinks with condition has-backlinks renders on a page that has backlinks", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("target"));
    await expect(page.locator(".backlinks")).toBeVisible();
    await expect(page.locator(".backlinks a.internal")).toHaveCount(1);
  });

  test("control: index links to target (so target has a backlink)", async ({
    page,
    site,
  }) => {
    // Verified manually: dropping the condition (overlay `condition: null`)
    // makes .backlinks render on /target.
    await page.goto(site.url("/"));
    await expect(
      page.locator('article a.internal[href*="target"]'),
    ).toHaveCount(1);
  });
});
