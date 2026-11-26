import { test, expect } from "../../helpers/repro-fixture";

// obsidian-plugin-excalidraw#15: initSidebar() added a click listener on every "nav" but its
// cleanup only removed the class. SPA navigation morphs the DOM and keeps the toggle button, so
// after one navigation a click toggled twice (no visible change).
async function spaTo(page: import("@playwright/test").Page, url: string) {
  await page.evaluate((u) => (window as any).spaNavigate(new URL(u)), url);
  await page.waitForURL(url);
}

test.describe("quartz-community/obsidian-plugin-excalidraw#15 sidebar toggle after SPA nav", () => {
  // 1 and 3 navigations: an even number of stacked listeners cancels out (2 navigations = 3 listeners worked)
  for (const hops of [1, 3]) {
    test(`toggle opens and closes the sidebar after ${hops} SPA navigation(s)`, async ({
      page,
      site,
      pageProblems,
    }) => {
      await page.goto(site.url("boards/one.excalidraw"));
      const frame = page.locator(".page[data-frame='excalidraw']");
      await expect(frame).toBeVisible();
      for (let i = 0; i < hops; i++) {
        await spaTo(
          page,
          site.url(
            i % 2 === 0 ? "boards/two.excalidraw" : "boards/one.excalidraw",
          ),
        );
      }
      await expect(frame).not.toHaveClass(/excalidraw-sidebar-open/);
      await page.locator(".excalidraw-sidebar-toggle").click();
      await expect(frame).toHaveClass(/excalidraw-sidebar-open/);
      await page.locator(".excalidraw-sidebar-toggle").click();
      await expect(frame).not.toHaveClass(/excalidraw-sidebar-open/);
      // the hand-drawn font loads from unpkg (offline in the sandbox): only local problems count
      expect(
        pageProblems
          .all()
          .filter(
            (p) => !p.includes("unpkg.com") && !p.includes("net::ERR_FAILED"),
          ),
      ).toEqual([]);
    });
  }

  test("control: toggle works on a direct load", async ({ page, site }) => {
    await page.goto(site.url("boards/one.excalidraw"));
    const frame = page.locator(".page[data-frame='excalidraw']");
    await page.locator(".excalidraw-sidebar-toggle").click();
    await expect(frame).toHaveClass(/excalidraw-sidebar-open/);
  });
});
