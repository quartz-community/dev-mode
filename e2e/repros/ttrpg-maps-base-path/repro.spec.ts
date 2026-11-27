import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// obsidian-plugin-ttrpg-tools-maps 1.0.2 with `baseUrl: localhost/sub`: the map image is
// requested from `/assets/world.svg` (the site root) instead of `/sub/assets/world.svg`, so it
// 404s and the map shows "Map failed to load" instead of the image and its markers. The
// transformer builds the image URL as "/" + its path in the content folder and ignores the base
// path.

test.describe("ttrpg-tools-maps under a base path", () => {
  test("the map image loads from the base path and the markers are drawn", async ({
    page,
    site,
    pageProblems,
  }) => {
    await blockExternalNetwork(page, site);
    const base = new URL(site.baseUrl).pathname.replace(/\/$/, "");
    expect(base).toBe("/sub");
    const imageRequest = page.waitForRequest((r) =>
      r.url().endsWith("/world.svg"),
    );
    await page.goto(site.url("world-map"));
    expect(new URL((await imageRequest).url()).pathname).toBe(
      `${base}/assets/world.svg`,
    );
    await expect(page.locator(".center .zm-root")).toHaveCount(1);
    await expect(page.locator(".center .ttrpg-map-error")).toHaveCount(0);
    await expect(page.locator(".center .zm-root .zm-marker")).toHaveCount(2);
    expect(pageProblems.all()).toEqual([]);
  });

  test("control: the image is in the built site under the base path", async ({
    page,
    site,
  }) => {
    const res = await page.request.get(site.url("assets/world.svg"));
    expect(res.status()).toBe(200);
  });
});
