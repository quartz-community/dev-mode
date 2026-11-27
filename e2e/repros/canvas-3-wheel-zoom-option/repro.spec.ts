import { test, expect, type Page } from "../../helpers/repro-fixture";
import {
  overflowingNodeCases,
  transform,
} from "../canvas-3-wheel-pans/scroll-cases";

// canvas-page `wheelBehavior: "zoom"`: the pre-#3 behaviour for mouse-first sites — a plain
// wheel zooms around the pointer instead of panning.

async function wheel(page: Page, init: WheelEventInit) {
  await page.locator(".canvas-container").evaluate((el, init) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        ...init,
      }),
    );
  }, init);
}

test.describe("canvas wheelBehavior: zoom", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("board.canvas"));
    await expect(page.locator(".canvas-container")).toHaveAttribute(
      "data-initialized",
      "true",
    );
  });

  test("the option reaches the page (data-wheel-behavior)", async ({
    page,
  }) => {
    await expect(page.locator(".canvas-container")).toHaveAttribute(
      "data-wheel-behavior",
      "zoom",
    );
  });

  test("a plain wheel zooms around the pointer, without panning it away", async ({
    page,
  }) => {
    const before = await transform(page);
    await wheel(page, { deltaY: -100 });
    const zoomedIn = await transform(page);
    expect(zoomedIn.scale).toBeCloseTo(before.scale * Math.exp(0.1), 4);

    // the point under the pointer stays put
    const centre = await page.locator(".canvas-container").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.width / 2, y: r.height / 2 };
    });
    const canvasPoint = (t: { x: number; y: number; scale: number }) => ({
      x: (centre.x - t.x) / t.scale,
      y: (centre.y - t.y) / t.scale,
    });
    expect(canvasPoint(zoomedIn).x).toBeCloseTo(canvasPoint(before).x, 1);
    expect(canvasPoint(zoomedIn).y).toBeCloseTo(canvasPoint(before).y, 1);

    await wheel(page, { deltaY: 100 });
    expect((await transform(page)).scale).toBeCloseTo(before.scale, 4);
  });

  test("shift + wheel zooms too (no sideways pan)", async ({ page }) => {
    const before = await transform(page);
    await wheel(page, { deltaY: 50, shiftKey: true });
    expect((await transform(page)).scale).toBeLessThan(before.scale);
  });
});

overflowingNodeCases("canvas-3-wheel-zoom-option", "zoom");
