import { test, expect } from "../../helpers/repro-fixture";

// Obsidian 1.15.0 (obsidian-bases-probe, vault q3-cards): a card is a div with a cover box
// whose height is card width x imageAspectRatio; property links are their own links.
const section = (page: import("@playwright/test").Page, n: number) =>
  page.locator("article .bases-inline").nth(n);

test.describe("bases cards as in Obsidian (bases-page#3, #10)", () => {
  test("each card is one grid item, not an <a> around other links", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("cards"));
    const grid = section(page, 0).locator(".bases-cards");
    // one grid child per note: the HTML parser no longer splits cards
    expect(await grid.evaluate((el) => el.children.length)).toBe(5);
    expect(await grid.locator(":scope > a").count()).toBe(0);
    expect(await page.locator("article a a").count()).toBe(0);
    // the property link opens its target, the rest of the card the card's note
    const land = grid.locator('.bases-card[data-slug="c-land"]');
    await expect(land.locator(".bases-card-title")).toHaveText("c-land");
    await land.locator('[data-property="note.related"] a').click();
    await expect(page).toHaveURL(/\/c-sq$/);
    expect(pageProblems.all()).toEqual([]);
  });

  test("clicking a card's cover opens its note", async ({ page, site }) => {
    await page.goto(site.url("cards"));
    // a real click on the cover area lands on the stretched file-name link
    const cover = await section(page, 0)
      .locator('.bases-card[data-slug="c-port"] .bases-card-cover')
      .boundingBox();
    await page.mouse.click(cover!.x + 20, cover!.y + 20);
    await expect(page).toHaveURL(/\/c-port$/);
  });

  test("cover height is card width x imageAspectRatio; empty cover without image", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("cards"));
    const ratio2 = section(page, 3);
    for (const slug of ["c-land", "c-none"]) {
      const card = ratio2.locator(`.bases-card[data-slug="${slug}"]`);
      const cover = await card.locator(".bases-card-cover").boundingBox();
      const box = await card.boundingBox();
      expect(cover).not.toBeNull();
      expect(Math.abs(cover!.height / cover!.width - 2)).toBeLessThan(0.02);
      expect(Math.abs(cover!.width - box!.width)).toBeLessThan(3);
    }
    // order: [] is a cover alone, no title
    await expect(section(page, 1).locator(".bases-card-title")).toHaveCount(0);
  });
});
