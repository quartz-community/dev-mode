import { test, expect } from "../../helpers/repro-fixture";
import type { Page } from "@playwright/test";
// Quartz 5.3: the SPA router restores scroll positions itself (#2674), keeping each history
// entry's position in history.state, including one still waiting to be saved (150 ms after the
// last scroll event) when Back or Forward leaves the page.

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
const scrollTo = (page: Page, y: number) =>
  page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
/** Longer than the router's 150 ms save delay. */
const settle = (page: Page) => page.waitForTimeout(400);
/** The page shown (link previews add their own article titles, so the document title is used). */
const title = (page: Page, text: string) =>
  expect(page).toHaveTitle(new RegExp(`^${text}\\b`));
/** Until the position stops changing (the page scrolls smoothly to a heading). */
const scrollSettled = (page: Page) =>
  expect
    .poll(async () => {
      const a = await scrollY(page);
      await page.waitForTimeout(200);
      return a === (await scrollY(page)) ? a : -1;
    })
    .toBeGreaterThan(1000);
/** The router swapped the page in, without a full load (the marker survives). */
const markPage = (page: Page) =>
  page.evaluate(
    () => ((window as unknown as { __marker: number }).__marker = 1),
  );
const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __marker?: number }).__marker);
/** Within 3 px of `y` (the position is restored after the page is swapped in). */
const near = (page: Page, y: number) =>
  expect
    .poll(
      async () =>
        Math.abs((await scrollY(page)) - y) <= 3 ||
        `scrollY ${await scrollY(page)}, wanted ${y}`,
      {
        timeout: 3000,
      },
    )
    .toBe(true);

test.describe("SPA scroll restoration (Quartz 5.3, #2674)", () => {
  test("Back returns to where the reader left the page", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await title(page, "Home");
    await markPage(page);
    const link = page.locator("article a.internal", { hasText: /^Other$/ });
    await link.scrollIntoViewIfNeeded();
    await scrollTo(page, (await scrollY(page)) + 50);
    await settle(page);
    const left = await scrollY(page);
    expect(left).toBeGreaterThan(1000);
    await link.click();
    await title(page, "Other");
    await near(page, 0);
    await page.goBack();
    await title(page, "Home");
    await near(page, left);
    expect(await marked(page)).toBe(1);
  });

  test("Forward returns to where the reader left the next page", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await page.locator("article a.internal", { hasText: /^Other$/ }).click();
    await title(page, "Other");
    await settle(page);
    await scrollTo(page, 1500);
    await settle(page);
    const left = await scrollY(page);
    expect(left).toBeGreaterThan(1000);
    await page.goBack();
    await title(page, "Home");
    await page.goForward();
    await title(page, "Other");
    await near(page, left);
  });

  test("a position not yet saved when Back left the page is kept for Forward", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await page.locator("article a.internal", { hasText: /^Other$/ }).click();
    await title(page, "Other");
    await settle(page);
    await scrollTo(page, 1700);
    const left = await scrollY(page);
    expect(left).toBeGreaterThan(1000);
    // within the 150 ms save delay
    await page.goBack();
    await title(page, "Home");
    await page.goForward();
    await title(page, "Other");
    await near(page, left);
  });

  test("Back after a heading link on the same page only scrolls back", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await title(page, "Home");
    await markPage(page);
    await near(page, 0);
    // (hovering the link fetches the page for its preview popover: only document loads count)
    const loads: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") loads.push(r.url());
    });
    await page
      .locator("article a.internal", { hasText: "Home section 25" })
      .click();
    await expect(page).toHaveURL(/#home-section-25$/);
    await scrollSettled(page);
    await page.goBack();
    await near(page, 0);
    expect(loads).toEqual([]);
    expect(await marked(page)).toBe(1);
  });

  test("a reload keeps the position", async ({ page, site }) => {
    await page.goto(site.url());
    await title(page, "Home");
    await scrollTo(page, 2000);
    await settle(page);
    const left = await scrollY(page);
    await page.reload();
    await title(page, "Home");
    await near(page, left);
  });
});
