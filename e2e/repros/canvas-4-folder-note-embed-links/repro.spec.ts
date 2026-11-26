import { test, expect } from "../../helpers/repro-fixture";

// canvas-page#4: links inside an embedded folder note (slug `folder/index`) were rebased one
// directory too high (utils normalizeHastElement: resolveRelative simplifies away `index`, then
// ".." removed a real segment). Only visible under a base path (`localhost/docs`).
async function embedHrefs(
  page: import("@playwright/test").Page,
  nodeText: string,
) {
  const node = page.locator(".canvas-node", { hasText: nodeText }).first();
  return node
    .locator("a.internal")
    .evaluateAll((els) =>
      els.map((e) => new URL((e as HTMLAnchorElement).href).pathname),
    );
}

test.describe("quartz-community/canvas-page#4 folder-note embed links", () => {
  test("links in an embedded folder note stay under the base path", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("board.canvas"));
    const hrefs = await embedHrefs(page, "Folder note linking");
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    expect(hrefs).toContain("/docs/other");
    expect(hrefs).toContain("/docs/folder/inside");
    for (const h of hrefs) {
      expect(
        (await page.request.get(new URL(h, page.url()).href)).status(),
        h,
      ).toBe(200);
    }
  });

  test("control: links in an embedded ordinary page resolve", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("board.canvas"));
    const hrefs = await embedHrefs(page, "from a plain page");
    expect(hrefs).toContain("/docs/other");
    expect(hrefs).toContain("/docs/folder/inside");
  });
});
