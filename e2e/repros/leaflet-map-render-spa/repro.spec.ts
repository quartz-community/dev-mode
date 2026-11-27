import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// obsidian-plugin-leaflet: a ```leaflet block (Obsidian Leaflet syntax) should render an
// initialised Leaflet map (`.leaflet-container` with its tile pane) and its markers, without
// page errors, also after SPA navigation between map pages.
//
// As of origin/main (bce98f2, npm 1.0.1) the repository is the unmodified plugin template: its
// manifest is still "plugin-template" and it has no Leaflet code, so the block stays a code
// block. Tile servers are answered locally (helpers/offline.ts).

async function expectMap(page: Page, markers: number) {
  const article = page.locator(".center article");
  // not left as a (highlighted) code block
  await expect(
    article.locator('pre[data-language="leaflet"], code.language-leaflet'),
  ).toHaveCount(0);
  const map = article.locator(".leaflet-container");
  await expect(map).toHaveCount(1);
  await expect(map.locator(".leaflet-tile-pane")).toHaveCount(1);
  await expect(map.locator(".leaflet-marker-icon")).toHaveCount(markers);
  const box = (await map.boundingBox())!;
  expect(Math.abs(box.height - 300)).toBeLessThanOrEqual(4);
}

test.describe("leaflet: map blocks", () => {
  test.beforeEach(async ({ page, site }) => {
    await blockExternalNetwork(page, site);
  });

  test("a leaflet block renders a map with its marker", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("amsterdam"));
    await expectMap(page, 1);
    expect(pageProblems.all()).toEqual([]);
  });

  test("SPA navigation between map pages shows each page's map", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("amsterdam"));
    await expectMap(page, 1);
    await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));
    await page
      .locator("article a.internal", { hasText: "Utrecht" })
      .last()
      .click();
    await page.waitForURL(/\/utrecht$/);
    await expectMap(page, 2);
    await page.locator("article a.internal", { hasText: "Amsterdam" }).click();
    await page.waitForURL(/\/amsterdam$/);
    await expectMap(page, 1);
    expect(
      await page.evaluate(() => (window as unknown as { __m?: number }).__m),
    ).toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });

  test("control: the page builds and shows its text", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("amsterdam"));
    await expect(page.locator(".center article")).toContainText(
      "A map of Amsterdam with one marker.",
    );
    expect(pageProblems.all()).toEqual([]);
  });
});
