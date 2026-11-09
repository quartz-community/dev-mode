import { test, expect } from "../../helpers/repro-fixture";

// Built-in core processing must work with none of the former "mandatory" plugins enabled.
// See README.md.

test.describe("built-ins work without note-properties / crawl-links / remove-draft / content-index", () => {
  test("frontmatter: page title and tags come from frontmatter", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(page).toHaveTitle(/Home Title From Frontmatter/);
    const index = await (
      await page.request.get(site.url("static/contentIndex.json"))
    ).json();
    expect(index["index"].title).toBe("Home Title From Frontmatter");
    expect(index["index"].tags).toEqual(["alpha-tag"]);
  });

  test("links: internal links resolve relative to the page", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const link = page.locator('article a.internal[data-slug="notes/target"]');
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveTitle(/Target Title/);
  });

  test("links: backlinks are populated, including links from frontmatter properties", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("notes/target"));
    await expect(page.locator(".backlinks a.internal")).toHaveText([
      /Home Title From Frontmatter/,
    ]);
    await page.goto(site.url("notes/linked-from-frontmatter"));
    await expect(page.locator(".backlinks a.internal")).toHaveText([
      /Home Title From Frontmatter/,
    ]);
  });

  test("contentIndex: entries carry titles and outgoing links", async ({
    page,
    site,
  }) => {
    const index = await (
      await page.request.get(site.url("static/contentIndex.json"))
    ).json();
    expect(index["notes/target"].title).toBe("Target Title");
    expect(index["index"].links).toEqual(
      expect.arrayContaining(["notes/target", "notes/linked-from-frontmatter"]),
    );
  });

  test("drafts: pages with draft: true are not published", async ({
    page,
    site,
  }) => {
    const response = await page.request.get(site.url("secret-draft"));
    expect(response.status()).toBe(404);
    const index = await (
      await page.request.get(site.url("static/contentIndex.json"))
    ).json();
    expect(Object.keys(index)).not.toContain("secret-draft");
  });

  test("contentIndex: sitemap and RSS are emitted", async ({ page, site }) => {
    expect((await page.request.get(site.url("sitemap.xml"))).status()).toBe(
      200,
    );
    expect((await page.request.get(site.url("index.xml"))).status()).toBe(200);
  });
});
