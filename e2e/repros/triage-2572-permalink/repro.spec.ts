import { test, expect } from "../../helpers/repro-fixture";
// #2572: docs say permalink is a URL that stays constant if the file moves; in practice it is only
// an alias redirect to the path-derived slug, which is also what sitemap/RSS/contentIndex use.
test.describe("jackyzha0/quartz#2572 permalink is the page URL", () => {
  test("/2024040414012730 serves the content (no redirect)", async ({
    page,
    site,
  }) => {
    const res = await page.request.get(site.url("2024040414012730"));
    const html = await res.text();
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain("Article body");
  });
  test("sitemap uses the permalink", async ({ page, site }) => {
    const xml = await (await page.request.get(site.url("sitemap.xml"))).text();
    expect(xml).toContain("2024040414012730");
  });
});
