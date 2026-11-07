import { test, expect } from "../../helpers/repro-fixture";
// #2521: ![[banner.svg]] with the file in a subfolder requested /banner.svg.
test.describe("jackyzha0/quartz#2521 SVG wikilink in subfolder resolves", () => {
  for (const p of ["/", "sub/note"]) {
    test(`embed on ${p} loads`, async ({ page, site, pageProblems }) => {
      await page.goto(site.url(p));
      const refs = await page
        .locator(
          'article object[data*="banner.svg"], article img[src*="banner.svg"]',
        )
        .evaluateAll((els) =>
          els.map(
            (e) => (e as HTMLObjectElement).data || (e as HTMLImageElement).src,
          ),
        );
      expect(refs.length).toBe(2);
      for (const r of refs)
        expect((await page.request.get(r)).status(), r).toBe(200);
      expect(pageProblems.all()).toEqual([]);
    });
  }
});
