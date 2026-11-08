import { test, expect } from "../../helpers/repro-fixture";

// Highlights keep their formatting, and a leading colour emoji colours them as in Obsidian 1.14.
test.describe("highlights: formatting and colours", () => {
  test("formatting inside a highlight is kept", async ({ page, site }) => {
    await page.goto(site.url(""));
    const mark = page.locator("article .text-highlight", { hasText: "bold" });
    await expect(mark).toHaveCount(1);
    await expect(mark.locator("strong")).toHaveText("bold");
    await expect(mark.locator("em")).toHaveText("italic");
  });

  test("a leading colour emoji colours the highlight and is removed", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    const red = page.locator('article mark[data-highlight="red"]');
    await expect(red).toHaveText(" red highlight");
    await expect(
      page.locator('article mark[data-highlight="green"]'),
    ).toHaveText(" green highlight");
    // coloured differently from a plain highlight
    const plain = page.locator("article mark.text-highlight", {
      hasText: "plain highlight",
    });
    const bg = (l: typeof red) =>
      l.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(red)).not.toBe(await bg(plain));
    expect(pageProblems.all()).toEqual([]);
  });
});
