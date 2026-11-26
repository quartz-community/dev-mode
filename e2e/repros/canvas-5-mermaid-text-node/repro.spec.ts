import { test, expect } from "../../helpers/repro-fixture";

// canvas-page#5: text nodes were rendered with bare micromark, so a ```mermaid fence stayed a code
// block. They now go through the site's Markdown plugins (ofm: Pele, the 5.3 default renderer).
test.describe("quartz-community/canvas-page#5 mermaid in canvas text nodes", () => {
  test("a mermaid fence in a text node renders as a diagram", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("board.canvas"));
    const node = page.locator('.canvas-node-text[data-node-id="m"]');
    await expect(node.locator("div.mermaid")).toHaveCount(1);
    await expect(node.locator("div.mermaid svg").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(node.locator("pre code.language-mermaid")).toHaveCount(0);
    expect(pageProblems.all()).toEqual([]);
  });

  test("diagram still renders after SPA navigation to the canvas", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("note"));
    await page.evaluate(
      (u) => (window as any).spaNavigate(new URL(u)),
      site.url("board.canvas"),
    );
    await expect(
      page
        .locator('.canvas-node-text[data-node-id="m"] div.mermaid svg')
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("other note markdown: callout, wikilink, math, highlighting", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("board.canvas"));
    const node = page.locator('.canvas-node-text[data-node-id="c"]');
    await expect(node.locator(".callout")).toHaveCount(1);
    const link = node.locator("a.internal", { hasText: "Note" });
    await expect(link).toHaveCount(1);
    expect(
      (
        await page.request.get(
          await link.evaluate((a) => (a as HTMLAnchorElement).href),
        )
      ).status(),
    ).toBe(200);
    await expect(node.locator(".katex")).toHaveCount(1);
    await expect(
      node.locator("pre code[data-language='js'], pre code.language-js"),
    ).toHaveCount(1);
  });
});
