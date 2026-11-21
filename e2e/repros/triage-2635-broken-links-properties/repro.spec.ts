import { test, expect } from "../../helpers/repro-fixture";
// #2635: with configuration.links.disableBrokenWikilinks, broken wikilinks in the note body get the
// `broken` class, but the same links in the note-properties view did not.
test.describe("jackyzha0/quartz#2635 broken wikilinks in properties", () => {
  test("control: the body's broken link is marked broken", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await expect(
      page.locator(".markdown-rendered a.internal", {
        hasText: "Missing note",
      }),
    ).toHaveClass(/\bbroken\b/);
  });

  test("a broken wikilink in a property is marked broken", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await expect(
      page.locator("a.note-properties-link", { hasText: "Missing note" }),
    ).toHaveClass(/\bbroken\b/);
  });

  test("a resolved wikilink in a property is not", async ({ page, site }) => {
    await page.goto(site.url());
    const link = page.locator("a.note-properties-link", {
      hasText: "Existing",
    });
    await expect(link).toHaveCount(1);
    await expect(link).not.toHaveClass(/\bbroken\b/);
  });
});
