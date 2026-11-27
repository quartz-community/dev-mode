import { test, expect, type Page } from "../../helpers/repro-fixture";

/**
 * A wheel over a text node whose text overflows scrolls the node first, the canvas only once
 * the node is scrolled to its end (canvas.inline.ts). Shared by canvas-3-wheel-pans (wheel
 * pans) and canvas-3-wheel-zoom-option (`wheelBehavior: zoom`, wheel zooms).
 */
export async function transform(page: Page) {
  return page.locator(".canvas-viewport").evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { x: m.e, y: m.f, scale: m.a };
  });
}

export function overflowingNodeCases(slug: string, mode: "pan" | "zoom") {
  test.use({ reproSlug: slug });

  test(`a wheel over an overflowing text node scrolls the node first (${mode})`, async ({
    page,
    site,
  }) => {
    await page.goto(site.url("board.canvas"));
    await expect(page.locator(".canvas-container")).toHaveAttribute(
      "data-initialized",
      "true",
    );
    const content = page
      .locator(".canvas-node", { hasText: "Long text node." })
      .locator(".canvas-node-content");
    await expect(content).toBeVisible();
    const sizes = await content.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client + 200);

    const box = (await content.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const start = await transform(page);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() => content.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(50);
    expect(await transform(page)).toEqual(start);

    // to the end of the node: from there the wheel moves the canvas
    await content.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => await transform(page)).not.toEqual(start);
    const after = await transform(page);
    if (mode === "pan") {
      expect(after.scale).toBeCloseTo(start.scale, 5);
      expect(after.y).toBeLessThan(start.y);
    } else {
      expect(after.scale).toBeLessThan(start.scale);
    }
  });
}
