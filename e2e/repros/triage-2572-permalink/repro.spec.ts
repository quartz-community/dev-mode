import { test, expect } from "../../helpers/repro-fixture";

// #2572: permalinks and aliases as in Obsidian Publish. `permalink` is the note's address on the
// site (the note at 日本語フォルダ/日本語記事.md is served at /2024040414012730); `aliases` are
// extra addresses that redirect to it, and so is the note's file path.
test.describe("jackyzha0/quartz#2572 permalink is the page's address", () => {
  test("the permalink serves the note itself", async ({ page, site }) => {
    const res = await page.request.get(site.url("2024040414012730"));
    const html = await res.text();
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain("Article body");
  });

  test("links to the note go to the permalink; its own links still resolve by file path", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    const link = page.locator(
      'article a.internal[data-slug="2024040414012730"]',
    );
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/\/2024040414012730$/);
    await expect(page.locator("article")).toContainText("Article body");
    // written relative to the file in 日本語フォルダ/, published at the site root
    await page.locator("article a.internal", { hasText: "sibling" }).click();
    await expect(page.locator("article")).toContainText("Sibling body.");
    expect(pageProblems.all()).toEqual([]);
  });

  test("the file path and aliases redirect to the permalink", async ({
    page,
    site,
  }) => {
    for (const address of [
      encodeURI("日本語フォルダ/日本語記事"),
      "old-article-name",
    ]) {
      await page.goto(site.url(address));
      await expect(page).toHaveURL(/\/2024040414012730$/);
      await expect(page.locator("article")).toContainText("Article body");
    }
  });

  test("sitemap and content index use the permalink", async ({
    page,
    site,
  }) => {
    const xml = await (await page.request.get(site.url("sitemap.xml"))).text();
    expect(xml).toContain("2024040414012730");
    expect(xml).not.toContain(encodeURI("日本語記事"));
    const index = await (
      await page.request.get(site.url("static/contentIndex.json"))
    ).json();
    expect(Object.keys(index)).toContain("2024040414012730");
    expect(Object.keys(index)).not.toContain("日本語フォルダ/日本語記事");
  });

  test("navigation keeps the note in its folder (explorer, folder page, breadcrumbs)", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("2024040414012730"));
    // explorer: the note is listed inside its folder, linking to the permalink
    const folder = page
      .locator('.explorer [data-folderpath="日本語フォルダ/index"]')
      .first();
    await expect(folder).toHaveCount(1);
    const inFolder = page.locator(
      '.explorer li:has([data-folderpath="日本語フォルダ/index"]) a[href$="2024040414012730"]',
    );
    await expect(inFolder).toHaveCount(1);
    // breadcrumbs: Home › 日本語フォルダ › Test Article
    await expect(page.locator(".breadcrumb-container")).toContainText(
      "日本語フォルダ",
    );
    // the folder page lists it
    await page.goto(site.url(encodeURI("日本語フォルダ/")));
    await expect(page.locator(".page-listing")).toContainText("Test Article");
  });
});
