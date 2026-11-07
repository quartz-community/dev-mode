import { test, expect } from "../../helpers/repro-fixture";

// #2482: TOC highlighting uses only an IntersectionObserver
// (repos/table-of-contents/src/components/scripts/toc.inline.ts:1-14). A heading
// that jumps from below the viewport to above it in one frame never changes its
// isIntersecting state, so no callback fires and its TOC link is never marked
// .in-view (and vice versa when scrolling up). A single scrollTo() jump is the
// deterministic version of a fast scroll-wheel/scrollbar drag. behavior: "instant"
// is needed because base.scss sets scroll-behavior: smooth.

test.describe("Repro for jackyzha0/quartz#2482", () => {
  test.use({ viewport: { width: 1280, height: 700 } });

  const state = (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("article h2[id]")).map(
        (h) => ({
          id: h.id,
          shouldBeInView: h.getBoundingClientRect().y < window.innerHeight,
          inView: !!document.querySelector(`a[data-for="${h.id}"].in-view`),
        }),
      ),
    );

  test("jump to bottom marks every passed heading in-view", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await page.waitForTimeout(300);
    await page.evaluate(() =>
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant",
      }),
    );
    await page.waitForTimeout(500);
    const s = await state(page);
    const wrong = s
      .filter((x) => x.inView !== x.shouldBeInView)
      .map((x) => x.id);
    expect(wrong).toEqual([]);
  });

  test("jump back to top clears headings below the viewport", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await page.waitForTimeout(300);
    // scroll down gradually so everything gets highlighted correctly
    for (let y = 0; y < 20000; y += 200) {
      await page.evaluate(
        (y) => window.scrollTo({ top: y, behavior: "instant" }),
        y,
      );
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(500);
    const s = await state(page);
    const wrong = s
      .filter((x) => x.inView !== x.shouldBeInView)
      .map((x) => x.id);
    expect(wrong).toEqual([]);
  });
});
