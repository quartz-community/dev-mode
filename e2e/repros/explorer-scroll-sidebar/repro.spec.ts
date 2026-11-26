import { test, expect, type Page } from "../../helpers/repro-fixture";

// quartz-community/explorer#14 and PR #15 with `layout.sidebars.left: scroll`: the sidebar
// scrolls, not the explorer's list (the reporter's `.sidebar.left` at 6200px).

test.use({ viewport: { width: 1400, height: 700 } });

/** The element that scrolls the explorer's list (what the reporter of #14 looked for). */
async function installScroller(page: Page) {
  await page.addInitScript(() => {
    (window as any).__scroller = () => {
      for (
        let n = document.querySelector(".explorer-ul");
        n && n !== document.body;
      ) {
        const o = getComputedStyle(n).overflowY;
        if (
          (o === "auto" || o === "scroll") &&
          n.scrollHeight > n.clientHeight + 1
        )
          return n;
        n = n.parentElement;
      }
      return null;
    };
  });
}

const scrollerTop = (page: Page) =>
  page.evaluate(() => (window as any).__scroller()?.scrollTop ?? null);

test.beforeEach(async ({ page }) => installScroller(page));

test.describe("explorer scrolling (scrolling sidebar)", () => {
  test("the sidebar is what scrolls; no fade on the list", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(page.locator(".explorer-ul li.nav-file")).toHaveCount(60);
    expect(
      await page.evaluate(() =>
        (window as any).__scroller()?.matches(".sidebar.left"),
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".explorer-ul")
        .evaluate((el) => el.lastElementChild?.className),
    ).toBe("overflow-end");
    await expect(page.locator(".explorer-ul")).not.toHaveClass(
      /gradient-active/,
    );
  });

  test("#14: SPA navigation keeps the explorer's scroll position", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(page.locator(".explorer-ul li.nav-file")).toHaveCount(60);
    await page.evaluate(() => ((window as any).__scroller().scrollTop = 600));
    const before = await scrollerTop(page);
    expect(before).toBeGreaterThan(500);
    // a link in view
    const name = await page.evaluate(() => {
      const box = (window as any).__scroller().getBoundingClientRect();
      const links = [
        ...document.querySelectorAll<HTMLElement>(".explorer-ul a"),
      ];
      const a = links.find(
        (l) => l.getBoundingClientRect().top > box.top + 100,
      )!;
      return a.textContent!;
    });
    await page.locator(".explorer-ul a", { hasText: name }).click();
    await expect(page.locator(".explorer-ul a.active")).toHaveText(name);
    await expect.poll(() => scrollerTop(page)).toBe(before);
  });

  test("PR #15: opening a page directly scrolls only the explorer to it", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/note-55"));
    const active = page.locator(".explorer-ul a.active");
    await expect(active).toHaveText("Note 55");
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const inView = await active.evaluate((a) => {
      const box = (window as any).__scroller().getBoundingClientRect();
      const r = a.getBoundingClientRect();
      return r.top >= box.top && r.bottom <= box.bottom;
    });
    expect(inView).toBe(true);
  });
});
