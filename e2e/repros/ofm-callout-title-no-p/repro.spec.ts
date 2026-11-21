import { test, expect } from "../../helpers/repro-fixture";
// A callout's title text sits in .callout-title-inner itself, as in Obsidian. obsidian-flavored-
// markdown wrapped it in a <p>, which Obsidian themes (via @quartz-themes/core) give paragraph
// margins, pushing the title a line below its icon. Quartz's own look must not change.
test.describe("callout titles without a paragraph", () => {
  test("the title holds its inline content directly", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    const inner = page.locator(".callout-title-inner");
    await expect(inner).toHaveCount(2);
    await expect(inner.locator("> p")).toHaveCount(0);
    await expect(inner.first()).toHaveText("A bold title");
    await expect(inner.first().locator("> strong")).toHaveText("bold");
    await expect(inner.nth(1)).toHaveText("Tip");
  });

  test("Quartz styles the title as before: callout colour, no margin, paragraph line height", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    const style = await page
      .locator(".callout-title-inner")
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        const icon = getComputedStyle(
          el.parentElement!.querySelector(".callout-icon")!,
        );
        return {
          color: cs.color,
          iconColor: icon.backgroundColor,
          margin: cs.margin,
          lineHeight: cs.lineHeight,
        };
      });
    expect(style.color).toBe(style.iconColor);
    expect(style.margin).toBe("0px");
    expect(style.lineHeight).toBe("25.6px");
  });
});
