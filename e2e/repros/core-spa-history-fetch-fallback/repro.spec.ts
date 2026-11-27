import type { Page, Route } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// Quartz core's SPA router (quartz/components/scripts/spa.inline.ts):
// - Back / Forward after SPA navigations show the right page (URL, title, content) without a
//   page load;
// - when fetching the next page fails (network error, or a response that isn't HTML), the
//   router falls back to a full navigation instead of leaving the old page with a new URL or a
//   half-swapped page.

const BODY: Record<string, string> = {
  "/": "The home page.",
  "/alpha": "Alpha body text.",
  "/beta": "Beta body text.",
  "/gamma": "Gamma body text.",
};
const TITLE: Record<string, string> = {
  "/": "Home",
  "/alpha": "Alpha",
  "/beta": "Beta",
  "/gamma": "Gamma",
};

/** Set a marker on window: it survives SPA navigations and is gone after a page load. */
const mark = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));
const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __m?: number }).__m === 1);

async function expectPage(page: Page, path: string) {
  await expect(page).toHaveURL((u) => u.pathname === path);
  await expect(page).toHaveTitle(new RegExp(`^${TITLE[path]}\\b`));
  await expect(page.locator(".center .article-title").first()).toHaveText(
    TITLE[path]!,
  );
  // (not a popover's article)
  const article = page.locator(".center article");
  await expect(article).toContainText(BODY[path]!);
  for (const [other, text] of Object.entries(BODY)) {
    if (other !== path) await expect(article).not.toContainText(text);
  }
}

async function clickTo(page: Page, text: string, path: string) {
  await page.locator("article a.internal", { hasText: text }).first().click();
  await expectPage(page, path);
}

/** Answer the router's / prefetcher's fetch() of `path` (not the browser's page load). */
async function onPageFetch(
  page: Page,
  path: string,
  handler: (route: Route) => Promise<void>,
) {
  const hits = { fetches: 0, documents: 0 };
  await page.route(
    (u) => u.pathname === path,
    async (route) => {
      if (route.request().resourceType() === "fetch") {
        hits.fetches++;
        await handler(route);
      } else {
        if (route.request().resourceType() === "document") hits.documents++;
        await route.fallback();
      }
    },
  );
  return hits;
}

/**
 * Problems other than the failing requests to `path` themselves: the browser's "Failed to load
 * resource" for them, the popover's logged fetch error (popover.inline.ts logs it) and fetches
 * of the page that the full navigation cancels.
 */
const unexpected = (problems: string[], path: string) =>
  problems.filter(
    (p) =>
      !p.startsWith("console.error: Failed to load resource:") &&
      !p.startsWith("console.error: TypeError: Failed to fetch") &&
      !new RegExp(
        `(HTTP 500: |requestfailed: )\\S+${path}( \\(net::ERR_(FAILED|ABORTED)\\))?$`,
      ).test(p),
  );

test.describe("SPA history", () => {
  test("Back and Forward restore URL, title and content without a reload", async ({
    page,
    site,
    pageProblems,
  }) => {
    await blockExternalNetwork(page, site);
    await page.addInitScript(() => {
      const w = window as unknown as { __navs: string[] };
      w.__navs = [];
      document.addEventListener("nav", (e) =>
        w.__navs.push((e as CustomEvent).detail.url),
      );
    });
    await page.goto(site.url());
    await expectPage(page, "/");
    await mark(page);

    await clickTo(page, "Alpha", "/alpha");
    await clickTo(page, "Beta", "/beta");
    await clickTo(page, "Gamma", "/gamma");

    await page.goBack();
    await expectPage(page, "/beta");
    await page.goBack();
    await expectPage(page, "/alpha");
    await page.goBack();
    await expectPage(page, "/");
    await page.goForward();
    await expectPage(page, "/alpha");
    await page.goForward();
    await expectPage(page, "/beta");

    // a new link after Back drops the forward entries
    await page.goBack();
    await expectPage(page, "/alpha");
    await clickTo(page, "home", "/");
    await page.goBack();
    await expectPage(page, "/alpha");
    await page.goForward();
    await expectPage(page, "/");

    expect(await marked(page)).toBe(true);
    // one `nav` per page shown (the first is the initial load)
    expect(
      await page.evaluate(
        () => (window as unknown as { __navs: string[] }).__navs,
      ),
    ).toEqual([
      "index",
      "alpha",
      "beta",
      "gamma",
      "beta",
      "alpha",
      "index",
      "alpha",
      "beta",
      "alpha",
      "index",
      "alpha",
      "index",
    ]);
    expect(pageProblems.all()).toEqual([]);
  });
});

test.describe("SPA fetch failure falls back to a full navigation", () => {
  test.beforeEach(async ({ page, site }) => {
    await blockExternalNetwork(page, site);
  });

  test("a network error loads the page normally", async ({
    page,
    site,
    pageProblems,
  }) => {
    const hits = await onPageFetch(page, "/beta", (route) =>
      route.abort("failed"),
    );
    await page.goto(site.url("alpha"));
    await mark(page);
    await clickTo(page, "Beta", "/beta");
    expect(hits.fetches).toBeGreaterThanOrEqual(1);
    expect(hits.documents).toBe(1);
    expect(await marked(page)).toBe(false);
    await expect(page.locator(".navigation-progress")).toHaveCount(0);
    // the router still works on the new page
    await mark(page);
    await clickTo(page, "Gamma", "/gamma");
    expect(await marked(page)).toBe(true);
    expect(unexpected(pageProblems.all(), "/beta")).toEqual([]);
  });

  test("a response that isn't HTML (500, text/plain) loads the page normally", async ({
    page,
    site,
    pageProblems,
  }) => {
    const hits = await onPageFetch(page, "/beta", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "upstream error",
      }),
    );
    await page.goto(site.url("alpha"));
    await mark(page);
    await clickTo(page, "Beta", "/beta");
    expect(hits.fetches).toBeGreaterThanOrEqual(1);
    expect(hits.documents).toBe(1);
    expect(await marked(page)).toBe(false);
    await expect(page.locator("body")).not.toContainText("upstream error");
    expect(unexpected(pageProblems.all(), "/beta")).toEqual([]);
  });

  test("an HTML error page (500) is shown as the server sent it, not mixed with the old page", async ({
    page,
    site,
    pageProblems,
  }) => {
    // The router swaps in any text/html response, whatever its status (that is how Quartz's
    // 404.html is shown). What must not happen: the new URL with the old page's content.
    await onPageFetch(page, "/beta", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/html",
        body: "<!doctype html><title>Server error</title><body><h1>Server error</h1></body>",
      }),
    );
    await page.goto(site.url("alpha"));
    await page
      .locator("article a.internal", { hasText: "Beta" })
      .first()
      .click();
    await expect(page).toHaveURL((u) => u.pathname === "/beta");
    await expect(page.locator("body h1")).toHaveText("Server error");
    await expect(page.locator("body")).not.toContainText(BODY["/alpha"]!);
    await expect(page.locator(".navigation-progress")).toHaveCount(0);
    // and Back shows Alpha again
    await page.goBack();
    await expectPage(page, "/alpha");
    expect(unexpected(pageProblems.all(), "/beta")).toEqual([]);
  });

  test("control: a working fetch is an SPA navigation", async ({
    page,
    site,
    pageProblems,
  }) => {
    const hits = await onPageFetch(page, "/beta", (route) => route.fallback());
    await page.goto(site.url("alpha"));
    await mark(page);
    await clickTo(page, "Beta", "/beta");
    expect(hits.fetches).toBeGreaterThanOrEqual(1);
    expect(hits.documents).toBe(0);
    expect(await marked(page)).toBe(true);
    expect(pageProblems.all()).toEqual([]);
  });
});
