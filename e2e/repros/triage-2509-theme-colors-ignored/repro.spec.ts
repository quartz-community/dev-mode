import { test, expect } from "../../helpers/repro-fixture";

// #2509 (by design, documented in docs/configuration.md): with @quartz-themes/core enabled
// (obsidian/ttrpg templates enable it), the theme colours text through Obsidian variables, so
// configuration.theme.colors has little effect in its modes. The documented way to change a
// theme's colours is to override its variables in custom.scss; this checks that snippet wins
// over the theme. (Verified once with the real quartz/styles/custom.scss too; repros can't
// overlay styles, so the snippet is injected here.)

// The snippet from docs/configuration.md (paragraphs use --text-muted, most other text --text-normal).
const DOCUMENTED_OVERRIDE = `html[saved-theme="dark"] body { --text-normal: #00ff00; --text-muted: #00ff00; }`;

test.describe("jackyzha0/quartz#2509: theme colours vs configured colours", () => {
  test("control: configured darkgray colours body text (light)", async ({
    page,
    site,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(site.url("/"));
    const c = await page
      .locator("article p")
      .first()
      .evaluate((p) => getComputedStyle(p).color);
    expect(c).toBe("rgb(255, 0, 0)");
  });

  test("the documented custom.scss override recolours a theme's text (dark)", async ({
    page,
    site,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(site.url("/"));
    const p = page.locator("article p").first();
    expect(await p.evaluate((el) => getComputedStyle(el).color)).not.toBe(
      "rgb(0, 255, 0)",
    );
    await page.addStyleTag({ content: DOCUMENTED_OVERRIDE });
    expect(await p.evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(0, 255, 0)",
    );
  });
});
