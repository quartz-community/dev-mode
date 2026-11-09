import { test, expect } from "../../helpers/repro-fixture";

// #2514: on a note with many headings, the right-sidebar TOC list cannot be
// scrolled to its last entry. Expected: after scrolling the TOC list to its
// end, the last TOC link is fully visible inside the list and viewport.

for (const vp of [
  { width: 1280, height: 800 },
  { width: 1280, height: 600 },
]) {
  test(`last TOC entry is reachable (${vp.width}x${vp.height})`, async ({
    page,
    site,
  }) => {
    await page.setViewportSize(vp);
    await page.goto(site.url("/"));
    const list = page.locator("ul.toc-content");
    await expect(list.locator("li > a")).toHaveCount(60);
    const res = await list.evaluate((ul) => {
      ul.scrollTop = ul.scrollHeight;
      const links = ul.querySelectorAll("li > a");
      const last = links[links.length - 1].getBoundingClientRect();
      const box = ul.getBoundingClientRect();
      let clippedBy: string | null = null;
      for (let p: Element | null = ul; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowY !== "visible") {
          const pr = p.getBoundingClientRect();
          if (last.bottom > pr.bottom + 1) clippedBy = p.className || p.tagName;
        }
      }
      return {
        lastBottom: last.bottom,
        ulBottom: box.bottom,
        vh: innerHeight,
        ulScroll: [ul.scrollHeight, ul.clientHeight],
        clippedBy,
      };
    });
    expect(res.clippedBy, JSON.stringify(res)).toBeNull();
    expect(res.lastBottom, JSON.stringify(res)).toBeLessThanOrEqual(res.vh);
  });
}
