import { test, expect } from "../../helpers/repro-fixture";

// #2532: with a community theme (here catppuccin; Aura isn't installed in the
// workspace), collapsing the desktop Explorer clips the bottom of the
// "Explorer" title: .explorer.collapsed is `flex: 0 1 1.2rem; overflow-y: hidden`
// while the theme makes the h2 taller than 1.2rem.

test.describe("Repro for jackyzha0/quartz#2532", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("collapsed explorer does not clip its title", async ({ page, site }) => {
    await page.goto(site.url("/"));
    const btn = page.locator("button.desktop-explorer");
    await expect(btn).toBeVisible();
    const explorer = page.locator(".sidebar.left .explorer").first();
    if (!(await explorer.evaluate((e) => e.classList.contains("collapsed")))) {
      await btn.click();
    }
    await expect(explorer).toHaveClass(/collapsed/);
    await page.waitForTimeout(400);
    const m = await explorer.evaluate((e) => {
      const h2 = e.querySelector("button.desktop-explorer h2")!;
      const cs = getComputedStyle(h2);
      return {
        explorerBottom: e.getBoundingClientRect().bottom,
        h2Bottom: h2.getBoundingClientRect().bottom,
        explorerH: e.getBoundingClientRect().height,
        h2H: h2.getBoundingClientRect().height,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
      };
    });
    expect(m.h2Bottom, JSON.stringify(m)).toBeLessThanOrEqual(
      m.explorerBottom + 0.5,
    );
  });
});
