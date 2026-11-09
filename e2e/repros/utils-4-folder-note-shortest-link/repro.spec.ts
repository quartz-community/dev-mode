import { test, expect } from "../../helpers/repro-fixture";

// quartz-community/utils#4: [[Topic]] for the folder note Area/Topic/Topic.md (slug area/topic/index)
// must reach the folder page, not a root-level "topic" that doesn't exist.
test("short wikilinks to a folder note reach it", async ({ page, site }) => {
  await page.goto(site.url("notes/source"));
  const links = page.locator("article a.internal", { hasText: "Topic" });
  const hrefs = await links.evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).href),
  );
  expect(hrefs.length).toBe(2);
  for (const href of hrefs) {
    expect((await page.request.get(href)).status(), href).toBe(200);
    await page.goto(href);
    await expect(page.locator("article")).toContainText("Folder note body.");
  }
  // the anchor reaches the heading
  expect(new URL(hrefs[1]!).hash).toBe("#section");
  await expect(page.locator("#section")).toHaveCount(1);
});
