import { test, expect } from "../../helpers/repro-fixture";

// ![[star.svg]] where star.svg lives in content/static/ renders
// <object data="star.svg"> relative to the page (features/star.svg → 404).
// Found by `just site-smoke fixture:bug-repro`. The bug-repro suite's OFM#2 test
// passes vacuously because it accepts any `article svg` (heading/link icons).

test.describe("SVG wikilink embed resolves to the real file", () => {
  test("embedded SVG resource loads (no 404)", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("features/svg-embed"));
    const embed = page.locator(
      'article object[data*="star.svg"], article img[src*="star.svg"]',
    );
    await expect(embed).toHaveCount(1);
    const ref =
      (await embed.getAttribute("data")) ?? (await embed.getAttribute("src"));
    const res = await page.request.get(new URL(ref!, page.url()).toString());
    expect(res.status(), `embed reference "${ref}" should resolve`).toBe(200);
    expect(pageProblems.all()).toEqual([]);
  });
});
