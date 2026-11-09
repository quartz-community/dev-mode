import { test, expect } from "../../helpers/repro-fixture";
// #2515: headings inside blockquotes/callouts show up in the table of contents (Obsidian omits them).
test.describe("jackyzha0/quartz#2515 TOC ignores headings in blockquotes", () => {
  test("only top-level headings in TOC", async ({ page, site }) => {
    await page.goto(site.url("/"));
    await expect(page.locator(".toc-content a")).toHaveText([
      "Real heading",
      "Second real",
    ]);
  });
});
