import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";

// Obsidian (1.15.1, probed) transcludes a note, section, block, canvas or base embedded with a
// Markdown link (`![](note.md)`, `![](note)`, `![](board.canvas)`) just like `![[note]]`.

/** The article paragraph or embed that follows the label `n:`. */
function item(page: Page, label: string) {
  return page
    .locator("article p", { hasText: new RegExp(`^${label}:`) })
    .first();
}

/**
 * The text of the embed after the paragraph labelled `n:`. A block embed can't sit in a <p>: the
 * parser closes the paragraph before it, so the embed is the next block.
 */
async function embedText(page: Page, label: string): Promise<string> {
  return item(page, label).evaluate((p) => {
    const inside = p.querySelector(".transclude, .internal-embed");
    if (inside) return (inside as HTMLElement).innerText;
    const next = (p.closest(".el-p") ?? p)
      .nextElementSibling as HTMLElement | null;
    return next?.innerText ?? "";
  });
}

test.describe("Markdown-link embeds (obsidian-flavored-markdown#17)", () => {
  test("control: ![[other]] is transcluded", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    expect(await embedText(page, "8")).toContain("Other body text.");
    expect(pageProblems.all()).toEqual([]);
  });

  test("notes, sections and blocks are transcluded, not broken images", async ({
    page,
    site,
  }) => {
    await page.goto(site.url(""));
    await expect(page.locator("article img")).toHaveCount(0);
    expect(await embedText(page, "1")).toContain("Other body text.");
    expect(await embedText(page, "2")).toContain("Other body text.");
    expect(await embedText(page, "3")).toContain("Spaced section text.");
    expect(await embedText(page, "3")).not.toContain("Spaced note body.");
    const block = await embedText(page, "4");
    expect(block).toContain("Section text.");
    expect(block).not.toContain("Other body text.");
    expect(await embedText(page, "5")).toContain("Deep note body.");
  });

  test("canvases and bases are transcluded", async ({ page, site }) => {
    await page.goto(site.url(""));
    expect(await embedText(page, "6")).toContain("Canvas card");
    expect(await embedText(page, "7")).toContain("embedder");
  });

  test("links resolve from a subfolder: relative, by name, from the root", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("sub/embedder"));
    await expect(page.locator("article img")).toHaveCount(0);
    expect(await embedText(page, "A")).toContain("Other body text.");
    expect(await embedText(page, "B")).toContain("Deep note body.");
    expect(await embedText(page, "C")).toContain("Other body text.");
    expect(await embedText(page, "D")).toContain("deep");
  });
});
