import { test, expect, type Page } from "../../helpers/repro-fixture";
import { graphNodes, installGraphProbe } from "../../helpers/graph-probe";
// graph.inline.ts at runtime: a graph at rest schedules no frames, d3 and PixiJS load only
// when a graph is about to be seen, and folder pages are recorded as visited.

/** Count requestAnimationFrame calls (d3's timer and the graph's renderer both use it). */
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__raf++;
      return raf(cb);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { __raf: number }).__raf);
}

/** Until a whole second passes without a frame being requested. */
async function settlesToIdle(page: Page, frames: () => Promise<number>) {
  await expect
    .poll(
      async () => {
        const before = await frames();
        await page.waitForTimeout(1000);
        return (await frames()) - before;
      },
      { timeout: 20000, intervals: [0] },
    )
    .toBe(0);
}

const title = (page: Page, text: string) =>
  expect(page).toHaveTitle(new RegExp(`^${text}\\b`));

test.describe("graph at rest", () => {
  test("requests no animation frames once the layout settles", async ({
    page,
    site,
    pageProblems,
  }) => {
    const frames = await countFrames(page);
    await installGraphProbe(page);
    await page.goto(site.url("a"));
    await expect(page.locator(".graph-container canvas")).toBeVisible();
    await expect
      .poll(async () => (await graphNodes(page)).map((n) => n.id).sort())
      .toEqual(["/", "a", "projects/example/note"]);
    // The layout animates first (the counter works) ...
    await expect.poll(frames).toBeGreaterThan(10);
    // ... then stops.
    await settlesToIdle(page, frames);
    expect(pageProblems.all()).toEqual([]);
  });

  test("and again after the global graph is opened and closed", async ({
    page,
    site,
  }) => {
    const frames = await countFrames(page);
    await page.goto(site.url("a"));
    await expect(page.locator(".graph-container canvas")).toBeVisible();
    await settlesToIdle(page, frames);

    const before = await frames();
    await page.locator(".global-graph-icon").first().click();
    const outer = page.locator(".global-graph-outer").first();
    await expect(outer).toHaveClass(/active/);
    await expect(outer.locator(".global-graph-container canvas")).toBeVisible();
    await expect
      .poll(async () => (await frames()) - before)
      .toBeGreaterThan(10);
    await page.keyboard.press("Escape");
    await expect(outer).not.toHaveClass(/active/);
    await expect(outer.locator("canvas")).toHaveCount(0);
    await settlesToIdle(page, frames);

    // Closed while still animating: the simulation must stop too.
    await page.locator(".global-graph-icon").first().click();
    await expect(outer.locator(".global-graph-container canvas")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(outer).not.toHaveClass(/active/);
    await settlesToIdle(page, frames);
  });

  test("and again after an SPA navigation away", async ({ page, site }) => {
    const frames = await countFrames(page);
    await installGraphProbe(page);
    await page.goto(site.url("a"));
    await expect(page.locator(".graph-container canvas")).toBeVisible();
    // Navigate while the first layout still animates.
    await page.locator("article a.internal", { hasText: /^Note$/ }).click();
    await title(page, "Note");
    await expect(page.locator(".graph-container canvas")).toHaveCount(1);
    // the new page's graph is drawn (Note's neighbours)
    await expect
      .poll(async () => (await graphNodes(page)).map((n) => n.id).sort())
      .toEqual(["/", "a", "projects/example/note"]);
    await settlesToIdle(page, frames);
  });
});

test.describe("graph libraries load lazily", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("no d3 / PixiJS request until the graph below the fold is scrolled into view", async ({
    page,
    site,
  }) => {
    const libs: string[] = [];
    page.on("request", (r) => {
      if (/cdn\.jsdelivr\.net\/npm\/(d3|pixi\.js)@/.test(r.url()))
        libs.push(new URL(r.url()).pathname);
    });
    await page.goto(site.url());
    await title(page, "Home");
    const graph = page.locator(".graph-container").first();
    await expect(graph).toBeAttached();
    const top = await graph.evaluate((el) => el.getBoundingClientRect().top);
    const viewport = await page.evaluate(() => window.innerHeight);
    // well outside the observer's 200 px margin
    expect(top).toBeGreaterThan(viewport + 1000);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(libs).toEqual([]);
    await expect(graph.locator("canvas")).toHaveCount(0);

    await graph.scrollIntoViewIfNeeded();
    await expect(graph.locator("canvas")).toBeVisible();
    expect(libs.sort()).toEqual([
      "/npm/d3@7.9.2/dist/d3.min.js",
      "/npm/pixi.js@8.23.0/dist/pixi.min.js",
    ]);
  });
});

test.describe("graph-visited", () => {
  const visited = (page: Page) =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("graph-visited") ?? "[]") as string[],
    );

  test("a folder page is recorded with its trailing slash", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("projects/example/"));
    await expect.poll(() => visited(page)).toContain("projects/example/");
  });

  test("also when reached by an SPA navigation", async ({ page, site }) => {
    await page.goto(site.url("projects/example/note"));
    await title(page, "Note");
    await expect.poll(() => visited(page)).toContain("projects/example/note");
    expect(await visited(page)).not.toContain("projects/example/");
    await page
      .locator(".breadcrumb-container a", { hasText: /^example$/i })
      .click();
    await expect(page).toHaveURL(/\/projects\/example\/$/);
    await expect.poll(() => visited(page)).toContain("projects/example/");
  });
});
