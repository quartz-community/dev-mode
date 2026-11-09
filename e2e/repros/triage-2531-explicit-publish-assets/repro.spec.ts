import { test, expect } from "../../helpers/repro-fixture";
import { existsSync } from "node:fs";
import { join } from "node:path";
// #2531: with explicit-publish, attachments referenced only by unpublished notes are still emitted.
test.describe("jackyzha0/quartz#2531 assets of unpublished notes are not emitted", () => {
  test("control: published note and its image are emitted", async ({
    page,
    site,
  }) => {
    expect(existsSync(join(site.dir, "public-pic.png"))).toBe(true);
    expect(existsSync(join(site.dir, "private-note.html"))).toBe(false);
    await page.goto(site.url("/"));
  });
  test("secret-diagram.png is not in the output", async ({ page, site }) => {
    const res = await page.request.get(site.url("secret-diagram.png"));
    expect(res.status()).toBe(404);
  });
});
