import { test, expect } from "../../helpers/repro-fixture";
// #2644: with 192 or more notes (threads = round(files / 128)) Quartz parses in worker threads; the context passed to them
// lacked ctx.permalinks, so links to a note with a permalink pointed at its file path.
test.describe("jackyzha0/quartz#2644 permalinks in worker threads", () => {
  test("a link to a permalinked note points at its permalink", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    const link = page
      .locator(".markdown-rendered a.internal", { hasText: "Moved" })
      .first();
    await expect(link).toHaveAttribute("data-slug", "elsewhere/moved");
    await expect(link).toHaveAttribute("href", /elsewhere\/moved$/);
  });

  test("the permalinked page holds the note", async ({ page, site }) => {
    const res = await page.request.get(site.url("elsewhere/moved"));
    expect(await res.text()).toContain("Moved body");
  });
});
