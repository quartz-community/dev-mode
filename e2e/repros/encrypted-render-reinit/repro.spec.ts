import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";

// Unlocking an encrypted page dispatches `render`, so components set themselves up a second time
// on the same page. Before the fixes (darkmode, reader-mode, syntax-highlighting, comments,
// encrypted-pages; all unreleased as of encrypted-pages 1.3.0 / darkmode 1.0.2 / reader-mode 1.0.2
// / syntax-highlighting 1.0.4 / comments 1.0.2):
//   - each `render` added another click listener to the theme and reader-mode toggles, so one click
//     toggled two or three times;
//   - code blocks got a second (third) copy button;
//   - giscus' client.js was appended again;
//   - after an unlisted page was unlocked, every later navigation dispatched `content-index-updated`
//     and `render` again, so the above happened on every page.
//
// Expected: one copy button per code block, one toggle per click, one client.js, and no `render`
// on a navigation that unlocks nothing new.

const GISCUS = "https://giscus.app/client.js";

type Counters = {
  render: number;
  indexUpdated: number;
  themechange: number;
  readermodechange: number;
};

async function counters(page: Page): Promise<Counters> {
  return page.evaluate(() => ({
    ...(window as unknown as { __counts: Counters }).__counts,
  }));
}

async function setup(page: Page) {
  const giscus = { requests: 0 };
  // no network to giscus: answer with an empty script and count the requests
  await page.route("https://giscus.app/**", async (route) => {
    if (route.request().url() === GISCUS) giscus.requests++;
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    });
  });
  await page.addInitScript(() => {
    const counts = {
      render: 0,
      indexUpdated: 0,
      themechange: 0,
      readermodechange: 0,
    };
    (window as unknown as { __counts: typeof counts }).__counts = counts;
    document.addEventListener("render", () => counts.render++);
    document.addEventListener(
      "content-index-updated",
      () => counts.indexUpdated++,
    );
    document.addEventListener("themechange", () => counts.themechange++);
    document.addEventListener(
      "readermodechange",
      () => counts.readermodechange++,
    );
  });
  return giscus;
}

/** Copy buttons per code block in the article. */
async function copyButtonsPerBlock(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("article pre")].map(
      (pre) => pre.querySelectorAll(":scope > .clipboard-button").length,
    ),
  );
}

async function giscusScripts(page: Page): Promise<number> {
  return page.locator(`.giscus script[src="${GISCUS}"]`).count();
}

/** One click on each toggle switches it once. */
async function togglesOnce(page: Page) {
  const html = page.locator("html");
  const theme = await html.getAttribute("saved-theme");
  const before = await counters(page);
  await page.locator(".darkmode").first().click();
  await expect
    .soft(html)
    .toHaveAttribute("saved-theme", theme === "dark" ? "light" : "dark");
  const reader = await html.getAttribute("reader-mode");
  await page.locator(".readermode").first().click();
  await expect
    .soft(html)
    .toHaveAttribute("reader-mode", reader === "on" ? "off" : "on");
  const after = await counters(page);
  // soft, so a failing run reports every component that set itself up twice
  expect
    .soft(
      after.themechange - before.themechange,
      "themechange events for one click",
    )
    .toBe(1);
  expect
    .soft(
      after.readermodechange - before.readermodechange,
      "readermodechange events for one click",
    )
    .toBe(1);
}

/** Wait until no more `render` events arrive. */
async function settle(page: Page) {
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = (await counters(page)).render;
        const stable = now === last;
        last = now;
        return stable;
      },
      { intervals: [300, 300, 300, 500, 500] },
    )
    .toBe(true);
}

async function unlock(page: Page) {
  await page.locator(".encrypted-page-input").fill("hunter2");
  await page.locator(".encrypted-page-submit").click();
  await expect(page.locator("article")).toContainText(
    "The secret page, with a code block.",
  );
  // the unlisted page's shadow index entry is added: content-index-updated (+ render)
  await expect
    .poll(async () => (await counters(page)).indexUpdated)
    .toBeGreaterThanOrEqual(1);
  await settle(page);
}

test.describe("unlocking an encrypted page sets components up once", () => {
  test("control: a normal page has one copy button per block, toggles once, loads giscus once", async ({
    page,
    site,
    pageProblems,
  }) => {
    const giscus = await setup(page);
    await page.goto(site.url("Normal"));
    await expect(page.locator(".giscus")).toBeAttached();
    await settle(page);
    expect
      .soft(await copyButtonsPerBlock(page), "copy buttons per code block")
      .toEqual([1]);
    await togglesOnce(page);
    expect.soft(await giscusScripts(page), "giscus client.js scripts").toBe(1);
    expect.soft(giscus.requests, "client.js requests").toBe(1);
    expect((await counters(page)).render).toBe(0);
    expect(pageProblems.all()).toEqual([]);
  });

  test("after unlocking: one copy button, one toggle per click, giscus once", async ({
    page,
    site,
    pageProblems,
  }) => {
    const giscus = await setup(page);
    await page.goto(site.url("Secret"));
    await expect(page.locator(".encrypted-page-input")).toBeVisible();
    await unlock(page);
    expect
      .soft(await copyButtonsPerBlock(page), "copy buttons per code block")
      .toEqual([1]);
    await togglesOnce(page);
    expect.soft(await giscusScripts(page), "giscus client.js scripts").toBe(1);
    expect.soft(giscus.requests, "client.js requests").toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });

  test("SPA navigation after unlocking: no extra render, still one of everything", async ({
    page,
    site,
    pageProblems,
  }) => {
    const giscus = await setup(page);
    await page.goto(site.url("Secret"));
    await unlock(page);
    const marker = await page.evaluate(
      () => ((window as unknown as { __m: number }).__m = 1),
    );

    // to the normal page: nothing new to unlock, so no `render`
    let before = await counters(page);
    await page.locator("article a.internal", { hasText: "Normal" }).click();
    await page.waitForURL(/\/normal$/);
    await expect(page.locator("article")).toContainText(
      "A normal page with a code block.",
    );
    await settle(page);
    expect(
      await page.evaluate(() => (window as unknown as { __m?: number }).__m),
    ).toBe(marker);
    let after = await counters(page);
    expect(
      after.render - before.render,
      "render events navigating to the normal page",
    ).toBe(0);
    expect(
      after.indexUpdated - before.indexUpdated,
      "content-index-updated navigating to the normal page",
    ).toBe(0);
    expect
      .soft(await copyButtonsPerBlock(page), "copy buttons per code block")
      .toEqual([1]);
    await togglesOnce(page);
    expect.soft(await giscusScripts(page), "giscus client.js scripts").toBe(1);
    expect.soft(giscus.requests, "client.js requests").toBe(2); // one per page

    // back to the secret page: it unlocks itself with the cached password (one `render`)
    before = await counters(page);
    await page.locator("article a.internal", { hasText: "Secret" }).click();
    await page.waitForURL(/\/secret$/);
    await expect(page.locator("article")).toContainText(
      "The secret page, with a code block.",
    );
    await settle(page);
    after = await counters(page);
    expect(
      after.render - before.render,
      "render events navigating back to the secret page",
    ).toBe(1);
    expect(
      after.indexUpdated - before.indexUpdated,
      "content-index-updated navigating back",
    ).toBe(0);
    expect
      .soft(await copyButtonsPerBlock(page), "copy buttons per code block")
      .toEqual([1]);
    await togglesOnce(page);
    expect.soft(await giscusScripts(page), "giscus client.js scripts").toBe(1);
    expect.soft(giscus.requests, "client.js requests").toBe(3);
    expect(pageProblems.all()).toEqual([]);
  });
});
