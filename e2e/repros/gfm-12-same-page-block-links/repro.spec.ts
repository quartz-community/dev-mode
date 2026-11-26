import { test, expect } from "../../helpers/repro-fixture";

// A same-page block link (`[x](#^real)`, `[[#^real]]`) must reach the block, whose id
// obsidian-flavored-markdown gives it (`^real` → id="^real"; since rehype-obsidian 1.6 block ids keep
// the `^`, so a heading of the same name keeps its own id, as in Obsidian).

test.describe("same-page block links (github-flavored-markdown#12)", () => {
  test("control: blocks have their ids, heading links resolve", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    await expect(page.locator('article [id="^real"]')).toHaveCount(1);
    await expect(page.locator('article [id="^item"]')).toHaveCount(1);
    await expect(
      page.locator("article a:not([role=anchor])", { hasText: "→ heading" }),
    ).toHaveAttribute("href", "#a-heading");
    expect(pageProblems.all()).toEqual([]);
  });

  test("block links point at the block's id", async ({ page, site }) => {
    await page.goto(site.url(""));
    const link = (text: string) => page.locator("article a", { hasText: text });
    await expect(link("→ block")).toHaveAttribute("href", "#^real");
    await expect(link("→ item")).toHaveAttribute("href", "#^item");
    await expect(link("wikilink to block")).toHaveAttribute("href", "#^real");
  });
});
