import { test, expect } from "../../helpers/repro-fixture";

// With tag-page disabled, an inline #tag only links when the content has a page for it.
test.describe("inline #tags link only to tag pages that exist (tag-page disabled)", () => {
  test("a tag without a page is not a link", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    const article = page.locator("article");
    await expect(
      article.locator("a.tag-link", { hasText: "orphan" }),
    ).toHaveCount(0);
    const span = article.locator("span.tag-link", { hasText: "orphan" });
    await expect(span).toHaveCount(1);
    // styled like a tag link: "#" prefix
    expect(
      await span.evaluate((el) => getComputedStyle(el, "::before").content),
    ).toBe('"#"');
    expect(pageProblems.all()).toEqual([]);
  });

  test("a tag with a hand-written page links to it", async ({ page, site }) => {
    await page.goto(site.url(""));
    const link = page.locator("article a.tag-link", { hasText: "written" });
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute("href");
    expect(
      (await page.request.get(new URL(href!, page.url()).href)).status(),
    ).toBe(200);
  });
});
