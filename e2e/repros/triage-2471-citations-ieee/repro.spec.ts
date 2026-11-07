import { test, expect } from "../../helpers/repro-fixture";
// #2471: numeric CSL styles (IEEE) emit div.csl-left-margin + div.csl-right-inline; with no CSS
// they stack as blocks, so "[1]" sits on its own line.
test.describe("jackyzha0/quartz#2471 numeric citation label on same line as entry", () => {
  test("[1] and the reference text share a line", async ({ page, site }) => {
    await page.goto(site.url("/"));
    const label = await page
      .locator(".csl-entry .csl-left-margin")
      .boundingBox();
    const body = await page
      .locator(".csl-entry .csl-right-inline")
      .boundingBox();
    expect(label && body).toBeTruthy();
    expect(Math.abs(label!.y - body!.y)).toBeLessThan(5);
    expect(body!.x).toBeGreaterThan(label!.x + label!.width - 1);
  });
});
