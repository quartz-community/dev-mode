import { test, expect } from "../../helpers/repro-fixture";

// See README.md. OFM with remark-obsidian 2.x and rehype-obsidian 1.2. Shared with
// ../ofm-remark-obsidian-2-strict, which builds the same content with `preset: strict`.

export function obsidianSyntaxCases(
  preset: "legacy" | "strict",
  reproSlug: string,
) {
  test.describe(`Obsidian syntax with remark-obsidian 2.x (${preset})`, () => {
    test.use({ reproSlug });

    test.beforeEach(async ({ page, site }) => {
      await page.goto(site.url("/"));
    });

    test("callouts render with Quartz's markup", async ({
      page,
      pageProblems,
    }) => {
      const tip = page.locator("article blockquote.callout.tip").first();
      await expect(
        tip.locator(":scope > .callout-title .callout-title-inner"),
      ).toHaveText("Callout title with bold");
      await expect(tip.locator(".callout-title-inner strong")).toHaveText(
        "bold",
      );
      await expect(tip.locator(":scope > .callout-content")).toContainText(
        "Callout body.",
      );

      const inner = tip.locator("blockquote.callout.warning");
      await expect(inner).toHaveClass(/is-collapsible/);
      await expect(inner).toHaveClass(/is-collapsed/);
      await expect(inner.locator(".callout-title-inner")).toHaveText(
        "Folded inner",
      );

      const example = page.locator(
        'article blockquote.callout[data-callout="example"]',
      );
      await expect(example).toHaveAttribute("data-callout-metadata", "wide");
      await expect(example).toHaveClass(/is-collapsible/);
      await expect(example).not.toHaveClass(/is-collapsed/);
      expect(pageProblems.all()).toEqual([]);
    });

    test("callout syntax inside code stays code", async ({ page }) => {
      const code = page
        .locator("article pre code")
        .filter({ hasText: "Not a callout" });
      await expect(code).toHaveCount(1);
      await expect(code).toContainText("> [!info] Not a callout");
      await expect(page.locator("article blockquote.callout.info")).toHaveCount(
        0,
      );
    });

    test("a soft line ending follows the preset (legacy: <br>, strict: space)", async ({
      page,
    }) => {
      const p = page.locator("article p").filter({ hasText: "First line" });
      await expect(p.locator("br")).toHaveCount(preset === "legacy" ? 1 : 0);
    });

    test("comments are hidden, with no stray elements", async ({ page }) => {
      const article = page.locator("article");
      await expect(article).toContainText("Visible");
      await expect(article).not.toContainText("hidden comment");
      await expect(article).not.toContainText("block comment");
      await expect(article.locator("obsidian-comment")).toHaveCount(0);
    });

    test("footnotes: undefined reference shows its label, inline footnotes work", async ({
      page,
    }) => {
      const p = page
        .locator("article p")
        .filter({ hasText: "A reference to nothing" });
      // legacy: Obsidian shows an undefined reference as its bare label; strict keeps it literal (GFM)
      if (preset === "legacy") {
        await expect(p).toContainText("nothingmissing");
        await expect(p).not.toContainText("[^missing]");
      } else {
        await expect(p).toContainText("nothing[^missing]");
      }
      await expect(
        page.locator("article section[data-footnotes]"),
      ).toContainText("inline note");
    });

    test("highlights, tags, wikilinks, tables, math and frontmatter", async ({
      page,
    }) => {
      await expect(page).toHaveTitle(/Obsidian syntax/);
      const article = page.locator("article");
      await expect(article.locator(".text-highlight")).toHaveText(
        "highlighted",
      );
      await expect(article.locator("a.tag-link")).toContainText("inline-tag");
      await expect(
        article.locator('a.internal[data-slug="target"]'),
      ).toHaveText("a wikilink");
      await expect(article.locator("table td")).toHaveText(["1", "2"]);
      await expect(article.locator(".katex").first()).toBeVisible();
      await expect(article.locator(".katex-display")).toHaveCount(1);
      await expect(article).not.toContainText("syntax-check"); // frontmatter isn't page text
    });
  });
}
