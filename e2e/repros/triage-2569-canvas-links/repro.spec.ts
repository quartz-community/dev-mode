import { test, expect } from "../../helpers/repro-fixture";

// #2569: Markdown links in canvas text nodes keep the raw "Note.md" href instead of the page slug.
// Text nodes are rendered with bare micromark (canvas-page/src/pageType.ts), so no link resolution
// and no wikilinks.
test.describe("jackyzha0/quartz#2569 canvas text-node links resolve", () => {
  test("[Note](Note.md) and [Other](sub/Other%20Note.md) resolve to pages", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("board.canvas"));
    const links = page.locator('.canvas-node-text a:not([href^="http"])');
    const hrefs = await links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const h of hrefs) {
      expect(h).not.toMatch(/\.md$/);
      expect((await page.request.get(h)).status(), h).toBe(200);
    }
  });
  test("[[Note]] wikilink in a text node becomes a link", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("board.canvas"));
    await expect(
      page.locator(".canvas-node-text a", { hasText: "Note" }),
    ).toHaveCount(2);
  });
  test("control: file node links to the note", async ({ page, site }) => {
    await page.goto(site.url("board.canvas"));
    await expect(page.locator("a.canvas-file-link")).toHaveAttribute(
      "href",
      "./note",
    );
  });
});
