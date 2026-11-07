import { test, expect } from "../../helpers/repro-fixture";

test.describe("layout.sidebars: left scroll, right static", () => {
  test.use({ viewport: { width: 1440, height: 700 } });

  test("left (scroll): the sidebar scrolls itself and nothing is out of reach", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    const left = page.locator(".sidebar.left");
    await expect(left).toHaveAttribute("data-sidebar-mode", "scroll");
    const last = page.locator(".explorer a", { hasText: "Note 60" });
    await expect(last).toHaveCount(1);
    const state = await left.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrolls: el.scrollHeight > el.clientHeight,
    }));
    expect(state).toEqual({ overflowY: "auto", scrolls: true });
    await left.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const box = await last.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(700);
    expect(pageProblems.all()).toEqual([]);
  });

  test("right (static): the sidebar scrolls away with the page", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const right = page.locator(".sidebar.right");
    await expect(right).toHaveAttribute("data-sidebar-mode", "static");
    expect(await right.evaluate((el) => getComputedStyle(el).position)).toBe(
      "static",
    );
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect
      .poll(() => right.evaluate((el) => el.getBoundingClientRect().top))
      .toBeLessThan(0);
  });

  test("mobile: sidebars keep their mobile layout", async ({ page, site }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto(site.url("/"));
    const left = page.locator(".sidebar.left");
    expect(
      await left.evaluate((el) => getComputedStyle(el).overflowY),
    ).not.toBe("auto");
    expect(
      await left.evaluate((el) => getComputedStyle(el).flexDirection),
    ).toBe("row");
  });
});
