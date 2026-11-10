import { test, expect } from "../../helpers/repro-fixture";

// Quartz 5.1 report (The World of Luciradis): with a tall explorer above recent notes in the left
// sidebar, recent notes got squeezed into a small scroll area of its own (its last entry cut off),
// while the explorer kept most of the sidebar. recent-notes can shrink since the #2463 fix, and
// flex shrank both in proportion to their height. Expected: the explorer gives up its height
// first and scrolls; recent notes stays whole while there is room for it.

test.describe("explorer squeezes recent notes", () => {
  test.use({ viewport: { width: 1400, height: 800 } });

  test("recent notes keeps its height; the explorer scrolls", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/characters/character-10"));
    const items = page.locator(".sidebar.left .recent-notes li");
    await expect(items).toHaveCount(3);
    const m = await page.evaluate(() => {
      const recent = document.querySelector<HTMLElement>(
        ".sidebar.left .recent-notes",
      )!;
      // the explorer's list is its scroll area (OverflowList)
      const list = document.querySelector<HTMLElement>(
        ".sidebar.left .explorer-ul",
      )!;
      const last = recent
        .querySelector("li:last-child")!
        .getBoundingClientRect();
      return {
        recentOverflow: recent.scrollHeight - recent.clientHeight,
        lastBottom: Math.round(last.bottom),
        recentBottom: Math.round(recent.getBoundingClientRect().bottom),
        vh: innerHeight,
        explorerScrolls: list.scrollHeight > list.clientHeight + 1,
      };
    });
    expect(m.recentOverflow, JSON.stringify(m)).toBeLessThanOrEqual(1);
    expect(m.lastBottom, JSON.stringify(m)).toBeLessThanOrEqual(
      m.recentBottom + 1,
    );
    expect(m.recentBottom, JSON.stringify(m)).toBeLessThanOrEqual(m.vh);
    expect(m.explorerScrolls, JSON.stringify(m)).toBe(true);
  });
});
