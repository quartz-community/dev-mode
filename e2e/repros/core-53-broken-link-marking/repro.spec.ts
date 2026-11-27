import { test, expect } from "../../helpers/repro-fixture";
// Quartz 5.3 marks links whose target isn't emitted, after the filters and page types ran.
// Each row: link text, expected mark (null = not broken), whether the target is served.
const LINKS: [
  text: string,
  mark: Record<string, string> | null,
  served: boolean,
][] = [
  ["A", null, true],
  ["Draft", { "data-filtered": "Drafts" }, false],
  ["Old name", { "data-filtered": "Drafts" }, false],
  ["Notes folder", null, true],
  ["Drafts folder", { "data-missing": "" }, false],
  ["Projects", null, true],
  ["Tag used", null, true],
  ["Tag unused", { "data-missing": "" }, false],
  ["RSS", null, true],
  ["Nowhere", {}, false],
];

test.describe("broken-link marking (Quartz 5.3)", () => {
  for (const [text, mark, served] of LINKS) {
    test(`${text}: ${mark === null ? "not broken" : "broken"}, target ${served ? "served" : "404"}`, async ({
      page,
      site,
      request,
    }) => {
      await page.goto(site.url());
      const link = page.locator("article a.internal", {
        hasText: new RegExp(`^${text}$`),
      });
      await expect(link).toHaveCount(1);
      if (mark === null) {
        await expect(link).not.toHaveClass(/\bbroken\b/);
        await expect(link).not.toHaveAttribute("data-filtered");
        await expect(link).not.toHaveAttribute("data-missing");
      } else {
        await expect(link).toHaveClass(/\bbroken\b/);
        for (const [attr, value] of Object.entries(mark)) {
          await expect(link).toHaveAttribute(attr, value);
        }
        for (const attr of ["data-filtered", "data-missing"].filter(
          (a) => !(a in mark),
        )) {
          await expect(link).not.toHaveAttribute(attr);
        }
      }
      const href = await link.getAttribute("href");
      const res = await request.get(new URL(href!, page.url()).toString());
      expect(res.status(), `GET ${href}`).toBe(served ? 200 : 404);
    });
  }

  test("the published folder note's own link back to a page is not broken", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("projects/"));
    const link = page.locator("article a.internal", { hasText: "A" });
    await expect(link).toHaveCount(1);
    await expect(link).not.toHaveClass(/\bbroken\b/);
  });
});
