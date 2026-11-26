import { test, expect } from "../../helpers/repro-fixture";

// ox-hugo#7: the textTransform regexes were greedy/unanchored and ran over code too.
test.describe("quartz-community/ox-hugo#7 greedy regexes", () => {
  test("code blocks and inline code are untouched", async ({ page, site }) => {
    await page.goto(site.url("/"));
    const article = page.locator("article");
    await expect(article.locator("pre code").nth(0)).toContainText(
      "<h1>{{ .Title }}</h1>",
    );
    await expect(article.locator("pre code").nth(1)).toContainText(
      "const o = {#private: 1}",
    );
    await expect(article.locator("p code", { hasText: "a {#x}" })).toHaveCount(
      1,
    );
  });

  test("two shortcodes on a line, dollar amounts", async ({ page, site }) => {
    await page.goto(site.url("/"));
    const article = page.locator("article");
    await expect(article).toContainText("Use < kbd A > and < kbd B > here.");
    await expect(article).toContainText("Costs $5 and the var is _x_ and $10.");
    await expect(
      article.locator("p", { hasText: "Costs" }).locator(".katex"),
    ).toHaveCount(0);
  });

  test("control: heading anchor stripped, org math rendered without KaTeX errors", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(page.locator("article h2#install")).toHaveText(/^Install$/);
    const math = page
      .locator("article p", { hasText: "Math from org" })
      .locator(".katex");
    await expect(math).toHaveCount(3);
    await expect(page.locator("article .katex-error")).toHaveCount(0);
  });
});
