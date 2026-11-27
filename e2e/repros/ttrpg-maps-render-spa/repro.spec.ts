import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// obsidian-plugin-ttrpg-tools-maps: a ```zoommap block becomes an interactive map (viewport,
// image, markers) with markers from a sidecar `.markers.json` or from the note itself
// (`storage: note`), the mouse wheel zooms it, and SPA navigation between map pages tears the
// old map down and builds the new one without errors.

const map = (page: Page) => ({
  root: page.locator(".center .zm-root"),
  image: page.locator(".center .zm-root img.zm-image"),
  markers: page.locator(".center .zm-root .zm-marker"),
  world: page.locator(".center .zm-root .zm-world"),
});

/** The map is built, its image loaded and laid out. */
async function expectMap(page: Page, tooltips: string[]) {
  const m = map(page);
  await expect(m.root).toHaveCount(1);
  await expect(m.root).toHaveAttribute("data-qz-ttrpg-map-inited", "true");
  await expect(page.locator(".ttrpg-map-error")).toHaveCount(0);
  await expect
    .poll(() => m.image.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(800);
  const box = (await m.root.boundingBox())!;
  // height: 300px (plus the border)
  expect(Math.abs(box.height - 300)).toBeLessThanOrEqual(4);
  expect(box.width).toBeGreaterThan(200);
  await expect(m.markers).toHaveCount(tooltips.length);
  await expect(m.markers.locator(".zm-marker-tooltip")).toHaveText(tooltips);
  await expect(m.markers.locator("img.zm-marker-icon")).toHaveCount(
    tooltips.length,
  );
  // markers sit inside the map
  for (const marker of await m.markers.all()) {
    const b = (await marker.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x);
    expect(b.x).toBeLessThanOrEqual(box.x + box.width);
    expect(b.y).toBeGreaterThanOrEqual(box.y);
    expect(b.y).toBeLessThanOrEqual(box.y + box.height);
  }
}

test.describe("ttrpg-tools-maps: render and SPA navigation", () => {
  test.beforeEach(async ({ page, site }) => {
    await blockExternalNetwork(page, site);
  });

  test("a sidecar-markers map renders, and the wheel zooms it", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("world-map"));
    await expectMap(page, ["The Prancing Pony", "The Tower"]);

    const m = map(page);
    const before = await m.world.evaluate((w) => w.style.transform);
    expect(before).toMatch(/scale3d/);
    const box = (await m.root.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -200);
    await expect
      .poll(() => m.world.evaluate((w) => w.style.transform))
      .not.toBe(before);
    expect(pageProblems.all()).toEqual([]);
  });

  test("a map with markers stored in the note renders", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("inline-map"));
    await expectMap(page, ["Camp"]);
    // the data block itself is not shown
    await expect(page.locator("article")).not.toContainText("ZOOMMAP-DATA");
    expect(pageProblems.all()).toEqual([]);
  });

  test("SPA navigation between map pages builds each map once", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("world-map"));
    await expectMap(page, ["The Prancing Pony", "The Tower"]);
    await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));

    await page.locator("article a.internal", { hasText: "Inline Map" }).click();
    await page.waitForURL(/\/inline-map$/);
    await expectMap(page, ["Camp"]);

    await page.locator("article a.internal", { hasText: "World Map" }).click();
    await page.waitForURL(/\/world-map$/);
    await expectMap(page, ["The Prancing Pony", "The Tower"]);

    await page.goBack();
    await page.waitForURL(/\/inline-map$/);
    await expectMap(page, ["Camp"]);

    // to a page without a map: nothing left behind
    await page.goto(site.url("world-map"));
    await expectMap(page, ["The Prancing Pony", "The Tower"]);
    await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));
    await page.locator(".page-title a, a.internal[href='.']").first().click();
    await expect(page).toHaveTitle(/^Home\b/);
    await expect(page.locator(".zm-root, .ttrpg-map-root")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __m?: number }).__m),
    ).toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });
});
