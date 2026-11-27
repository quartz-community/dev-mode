import { test, expect, type Page } from "../../helpers/repro-fixture";
import { overflowingNodeCases, transform } from "./scroll-cases";

// canvas-page#3: a two-finger trackpad scroll zoomed the canvas. Like Obsidian/Figma it should pan;
// a pinch (ctrl + wheel in Chromium/Firefox) or Ctrl/Cmd + wheel zooms.

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

test.describe("quartz-community/canvas-page#3 wheel pans, pinch zooms", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("board.canvas"));
    await expect(page.locator(".canvas-container")).toHaveAttribute(
      "data-initialized",
      "true",
    );
  });

  test("two-finger scroll pans without zooming", async ({ page }) => {
    const before = await transform(page);
    await wheel(page, { deltaX: 30, deltaY: 40 });
    const after = await transform(page);
    expect(after.scale).toBeCloseTo(before.scale, 5);
    expect(after.x).toBeCloseTo(before.x - 30, 1);
    expect(after.y).toBeCloseTo(before.y - 40, 1);
  });

  test("real mouse wheel pans vertically", async ({ page }) => {
    // an empty spot of the canvas (over a node, the wheel may scroll the node instead)
    const spot = await page.locator(".canvas-container").evaluate((el) => {
      const r = el.getBoundingClientRect();
      for (let fy = 0.1; fy < 1; fy += 0.1)
        for (let fx = 0.1; fx < 1; fx += 0.1) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          const hit = document.elementFromPoint(x, y);
          if (
            hit &&
            el.contains(hit) &&
            !hit.closest(".canvas-node, .canvas-controls")
          )
            return { x, y };
        }
      return null;
    });
    expect(spot).not.toBeNull();
    await page.mouse.move(spot!.x, spot!.y);
    const before = await transform(page);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(async () => (await transform(page)).y)
      .toBeLessThan(before.y - 50);
    expect((await transform(page)).scale).toBeCloseTo(before.scale, 5);
  });

  test("control: pinch (ctrl + wheel) zooms around the pointer", async ({
    page,
  }) => {
    const before = await transform(page);
    await wheel(page, { deltaY: -5, ctrlKey: true });
    const zoomedIn = await transform(page);
    expect(zoomedIn.scale).toBeGreaterThan(before.scale);
    expect(zoomedIn.scale).toBeLessThan(before.scale * 1.1);
    for (let i = 0; i < 5; i++)
      await wheel(page, { deltaY: 100, ctrlKey: true });
    expect((await transform(page)).scale).toBeLessThan(zoomedIn.scale);
  });

  test("Cmd + wheel zooms (macOS mouse)", async ({ page }) => {
    const before = await transform(page);
    await wheel(page, { deltaY: -100, metaKey: true });
    expect((await transform(page)).scale).toBeCloseTo(
      before.scale * Math.exp(0.1),
      4,
    );
  });

  test("shift + wheel pans sideways", async ({ page }) => {
    const before = await transform(page);
    await wheel(page, { deltaY: 50, shiftKey: true });
    const after = await transform(page);
    expect(after.x).toBeCloseTo(before.x - 50, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });
});

overflowingNodeCases("canvas-3-wheel-pans", "pan");
