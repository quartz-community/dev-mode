import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";
import { graphStub, stubGraphLibraries } from "../../helpers/graph-stub";

// graph 1.0.9: on a direct page load the local graph is laid out and drawn twice. graph.inline.ts
// calls handleNav() itself when it runs, and again for the first `nav` event, which Quartz's
// router (a separate script) dispatches later. When d3 / PixiJS are already loaded by then (here:
// stand-ins served at once, as from the browser cache), the first render gets past its
// generation check, creates a PixiJS application and starts a d3 simulation, and is destroyed
// as soon as it finishes because the second render replaced it.

test.describe("graph: one local graph render per page", () => {
  test.beforeEach(async ({ page, site }) => {
    await blockExternalNetwork(page, site);
    await stubGraphLibraries(page);
  });

  test("a direct load draws the local graph once", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("alpha"));
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);
    await page.waitForTimeout(1000);
    const s = (await graphStub(page))!;
    expect(s.simulations, "d3 simulations started").toEqual([3]);
    expect(s.apps, "PixiJS applications created").toBe(1);
    expect(s.destroyed).toBe(0);
    expect(pageProblems.all()).toEqual([]);
  });

  test("control: an SPA navigation draws the new page's local graph once", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("alpha"));
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);
    await page.waitForTimeout(1000);
    const before = (await graphStub(page))!;
    await page
      .locator("article a.internal", { hasText: "Beta" })
      .first()
      .click();
    await page.waitForURL(/\/beta$/);
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);
    await page.waitForTimeout(1000);
    const after = (await graphStub(page))!;
    // Beta's neighbourhood: Beta, Alpha, Gamma
    expect(after.simulations.slice(before.simulations.length)).toEqual([3]);
    expect(after.apps - before.apps).toBe(1);
    expect(after.apps - after.destroyed).toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });
});
