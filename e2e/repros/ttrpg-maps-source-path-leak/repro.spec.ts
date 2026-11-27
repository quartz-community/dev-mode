import { dirname, join } from "node:path";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// obsidian-plugin-ttrpg-tools-maps 1.0.2: every map's `data-qz-ttrpg-map-cfg` attribute carries
// `resolvedImageUrls[].sourcePath`, the image's absolute path on the machine that built the site
// (e.g. /home/<user>/<vault>/assets/world.svg), so the published HTML discloses the builder's
// file system layout. The browser script only needs `url` / `destRel`.

test.describe("ttrpg-tools-maps: published HTML", () => {
  test("does not contain the build machine's file paths", async ({
    page,
    site,
    pageProblems,
  }) => {
    await blockExternalNetwork(page, site);
    const res = await page.request.get(site.url("world-map"));
    const html = await res.text();
    expect(html).toContain("ttrpg-map-root");
    // the content folder of this repro, wherever the workspace is checked out
    const contentDir = join(dirname(test.info().file), "content");
    expect(html.includes(contentDir), `HTML contains ${contentDir}`).toBe(
      false,
    );
    expect(html.includes("sourcePath"), "HTML contains sourcePath").toBe(false);

    // and the map still works
    await page.goto(site.url("world-map"));
    await expect
      .poll(() =>
        page
          .locator(".center .zm-root img.zm-image")
          .evaluate((i: HTMLImageElement) => i.naturalWidth),
      )
      .toBe(800);
    await expect(page.locator(".center .zm-root .zm-marker")).toHaveCount(2);
    expect(pageProblems.all()).toEqual([]);
  });
});
