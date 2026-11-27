import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";
import {
  D3_URL,
  PIXI_URL,
  graphStub,
  stubGraphLibraries,
} from "../../helpers/graph-stub";

// graph.inline.ts: opening the global graph (its button, Ctrl+G) draws it into
// `.global-graph-outer`, closing it (Escape, Ctrl+G again, a click outside, a navigation)
// destroys it, and all of that still works once per action after SPA navigations.
//
// No network: d3 and PixiJS (jsDelivr) are replaced by the stand-ins of helpers/graph-stub.ts,
// so this tests the plugin's own code (loading, open / close, cleanup), not d3's layout or
// PixiJS's drawing (repro graph-runtime does that, with the real libraries from the network).

async function setup(page: Page, site: { baseUrl: string }) {
  await blockExternalNetwork(page, site);
  return stubGraphLibraries(page);
}

const stub = graphStub;

const outer = (page: Page) => page.locator(".global-graph-outer").first();
const globalCanvas = (page: Page) =>
  page.locator(".global-graph-outer .global-graph-container canvas");

async function expectOpen(page: Page) {
  await expect(outer(page)).toHaveClass(/active/);
  await expect(globalCanvas(page)).toHaveCount(1);
  await expect(globalCanvas(page)).toBeVisible();
}

async function expectClosed(page: Page) {
  await expect(outer(page)).not.toHaveClass(/active/);
  await expect(globalCanvas(page)).toHaveCount(0);
  await expect(outer(page)).toBeHidden();
}

test.describe("graph: global graph open / close", () => {
  test("the button opens it with every page, Escape closes it", async ({
    page,
    site,
    pageProblems,
  }) => {
    const libs = await setup(page, site);
    await page.goto(site.url("alpha"));
    // the local graph (in view in the right sidebar) is drawn
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);
    await expectClosed(page);
    // its neighbourhood: Alpha, Home, Beta (drawn twice on a direct load: see repro
    // graph-double-render-direct-load)
    await expect
      .poll(async () => (await stub(page))?.simulations.at(-1))
      .toBe(3);
    const before = (await stub(page))!;
    const locals = before.simulations.length;

    await page.locator(".global-graph-icon").first().click();
    await expectOpen(page);
    // one more simulation, with more nodes than the local graph's (every page)
    await expect
      .poll(async () => (await stub(page))?.simulations.length)
      .toBe(locals + 1);
    expect((await stub(page))!.simulations[locals]).toBeGreaterThanOrEqual(4);

    await page.keyboard.press("Escape");
    await expectClosed(page);
    // the global graph's application was destroyed, the local one is left
    const after = (await stub(page))!;
    expect(after.destroyed - before.destroyed).toBe(1);
    expect(after.apps - after.destroyed).toBe(1);
    // the libraries were loaded once
    expect(libs.sort()).toEqual([D3_URL, PIXI_URL]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("Ctrl+G toggles it; a click outside closes it", async ({
    page,
    site,
    pageProblems,
  }) => {
    await setup(page, site);
    await page.goto(site.url("alpha"));
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);

    await page.keyboard.press("Control+g");
    await expectOpen(page);
    await page.keyboard.press("Control+g");
    await expectClosed(page);

    // a click outside the graph closes it, a click inside does not
    await page.keyboard.press("Control+g");
    await expectOpen(page);
    await page.locator(".global-graph-container").first().click();
    await expectOpen(page);
    await page.mouse.click(5, 5);
    await expectClosed(page);

    // (the open graph covers the button, so the button only opens it)
    await page.locator(".global-graph-icon").first().click();
    await expectOpen(page);
    await page.keyboard.press("Escape");
    await expectClosed(page);
    const s = (await stub(page))!;
    expect(s.apps - s.destroyed).toBe(1); // only the local graph is left
    expect(pageProblems.all()).toEqual([]);
  });

  test("after SPA navigations, one press or click toggles it once", async ({
    page,
    site,
    pageProblems,
  }) => {
    await setup(page, site);
    await page.goto(site.url("alpha"));
    await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));
    for (const [text, path] of [
      ["Beta", /\/beta$/],
      ["Gamma", /\/gamma$/],
      ["Beta", /\/beta$/],
    ] as const) {
      await page
        .locator("article a.internal", { hasText: text })
        .first()
        .click();
      await page.waitForURL(path);
      await expect(page).toHaveTitle(new RegExp(`^${text}\\b`));
    }
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);

    await page.locator(".global-graph-icon").first().click();
    await expectOpen(page);
    await page.keyboard.press("Escape");
    await expectClosed(page);
    await page.keyboard.press("Control+g");
    await expectOpen(page);
    await page.keyboard.press("Control+g");
    await expectClosed(page);

    // open during a navigation (Back): the new page starts with it closed, and the open
    // graph was destroyed, not left behind
    await page.keyboard.press("Control+g");
    await expectOpen(page);
    await page.goBack();
    await page.waitForURL(/\/gamma$/);
    await expect(page).toHaveTitle(/^Gamma\b/);
    await expectClosed(page);
    await page.keyboard.press("Control+g");
    await expectOpen(page);
    await page.keyboard.press("Escape");
    await expectClosed(page);

    const s = (await stub(page))!;
    // one local graph left, everything else cleaned up
    expect(s.apps - s.destroyed).toBe(1);
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as { __m?: number }).__m),
    ).toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });
});
