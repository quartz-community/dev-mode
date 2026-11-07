import { test, expect } from "../../helpers/repro-fixture";

// #2463: with recent-notes in the left sidebar and a short window, the list is
// cut off: the sticky 100vh sidebar has no scroll and the page doesn't grow.
// Expected: every recent-note entry is reachable (visible inside the viewport
// after scrolling the page or the sidebar).

test.describe("Repro for jackyzha0/quartz#2463", () => {
  test.use({ viewport: { width: 1280, height: 500 } });

  test("last recent note is reachable in a short window", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const items = page.locator(".sidebar.left .recent-notes li");
    await expect(items).toHaveCount(10);
    const last = items.last();
    // try both scrolling mechanisms a user has: scroll the page, scroll the sidebar / list
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      for (const el of document.querySelectorAll<HTMLElement>(
        ".sidebar.left, .sidebar.left *",
      )) {
        if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
    });
    const vis = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      // walk ancestors to find clipping by overflow
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowY !== "visible") {
          const pr = p.getBoundingClientRect();
          if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1) clipped = true;
        }
      }
      return { top: r.top, bottom: r.bottom, vh: innerHeight, clipped };
    });
    expect(vis, JSON.stringify(vis)).toMatchObject({ clipped: false });
    expect(vis.bottom).toBeLessThanOrEqual(vis.vh + 1);
  });
});
