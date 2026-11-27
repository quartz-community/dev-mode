import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// search.inline.ts: the `#tag` search mode (the tag dropdown, picking a tag with the keyboard,
// filtering by tag, Ctrl+Shift+K) and keyboard navigation of the results with ArrowUp /
// ArrowDown / Tab / Shift+Tab / Enter. search-enter-navigation covers ArrowDown + Enter only.
//
// Tags: Bread [cooking, baking], Cake [baking], Soup [cooking], Hiking [outdoors].
// Pages mentioning "bread": Bread, Soup, Hiking.

const ui = (page: Page) => ({
  button: page.locator("button.search-button").first(),
  container: page.locator(".search-container").first(),
  bar: page.locator("input.search-bar").first(),
  dropdown: page.locator(".tag-suggestions").first(),
  suggestions: page.locator(".tag-suggestions .tag-suggestion-item"),
  cards: page.locator(".results-container .result-card:not(.no-match)"),
});

async function open(page: Page) {
  const s = ui(page);
  await s.button.click();
  await expect(s.container).toHaveClass(/active/);
  await expect(s.bar).toBeFocused();
  return s;
}

const titles = (page: Page) =>
  ui(page)
    .cards.locator(".card-title")
    .allTextContents()
    .then((t) => t.sort());

/** Index of the focused result card, or -1. */
const focusedIndex = (page: Page) =>
  ui(page).cards.evaluateAll((cards) =>
    cards.findIndex((c) => c.classList.contains("focus")),
  );

test.describe("search: #tag mode", () => {
  test.beforeEach(async ({ page, site }) => {
    await blockExternalNetwork(page, site);
    await page.goto(site.url());
    await expect(page).toHaveTitle(/^Home\b/);
  });

  test("typing # lists the tags, more letters narrow the list", async ({
    page,
    pageProblems,
  }) => {
    const s = await open(page);
    await s.bar.pressSequentially("#");
    await expect(s.dropdown).toBeVisible();
    await expect(s.suggestions).toHaveText([
      "#baking",
      "#cooking",
      "#outdoors",
    ]);
    await expect(s.suggestions.nth(0)).toHaveClass(/active/);
    await s.bar.pressSequentially("co");
    await expect(s.suggestions).toHaveText(["#cooking"]);
    // the rest of the selected tag is shown as ghost text
    await expect(page.locator(".ghost-text").first()).toContainText("oking");
    await s.bar.pressSequentially("x");
    await expect(s.dropdown).toBeHidden();
    expect(pageProblems.all()).toEqual([]);
  });

  test("ArrowDown / ArrowUp / Enter pick a tag and the results are filtered by it", async ({
    page,
    pageProblems,
  }) => {
    const url = page.url();
    const s = await open(page);
    await s.bar.pressSequentially("#");
    await expect(s.suggestions).toHaveCount(3);
    await s.bar.press("ArrowDown");
    await expect(s.suggestions.nth(1)).toHaveClass(/active/);
    await s.bar.press("ArrowDown");
    await s.bar.press("ArrowDown"); // stays on the last one
    await expect(s.suggestions.nth(2)).toHaveClass(/active/);
    await s.bar.press("ArrowUp");
    await expect(s.suggestions.nth(1)).toHaveClass(/active/);
    await expect(s.suggestions.nth(0)).not.toHaveClass(/active/);

    // Enter accepts the tag (it does not open a result)
    await s.bar.press("Enter");
    await expect(s.bar).toHaveValue("#cooking ");
    await expect(s.dropdown).toBeHidden();
    await expect.poll(() => titles(page)).toEqual(["Bread", "Soup"]);
    await expect(s.container).toHaveClass(/active/);
    expect(page.url()).toBe(url);

    // Tab accepts too: "#b" → "#baking "
    await s.bar.fill("");
    await s.bar.pressSequentially("#b");
    await expect(s.suggestions).toHaveText(["#baking"]);
    await s.bar.press("Tab");
    await expect(s.bar).toHaveValue("#baking ");
    await expect(s.bar).toBeFocused();
    await expect.poll(() => titles(page)).toEqual(["Bread", "Cake"]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("a tag and words: only pages with the tag that match the words", async ({
    page,
    pageProblems,
  }) => {
    const s = await open(page);
    await s.bar.fill("bread");
    await expect.poll(() => titles(page)).toEqual(["Bread", "Hiking", "Soup"]);
    await s.bar.fill("#baking bread");
    await expect.poll(() => titles(page)).toEqual(["Bread"]);
    await s.bar.fill("#outdoors bread");
    await expect.poll(() => titles(page)).toEqual(["Hiking"]);
    await s.bar.fill("#cooking #baking");
    await expect.poll(() => titles(page)).toEqual(["Bread"]);
    await s.bar.fill("#outdoors cake");
    await expect(s.cards).toHaveCount(0);
    await expect(page.locator(".results-container .no-match")).toBeVisible();
    expect(pageProblems.all()).toEqual([]);
  });

  test("Ctrl+Shift+K opens search in tag mode", async ({
    page,
    pageProblems,
  }) => {
    const s = ui(page);
    await page.locator("body").press("Control+Shift+K");
    await expect(s.container).toHaveClass(/active/);
    await expect(s.bar).toHaveValue("#");
    await expect(s.bar).toBeFocused();
    await expect(s.suggestions).toHaveText([
      "#baking",
      "#cooking",
      "#outdoors",
    ]);
    await s.bar.press("Enter");
    await expect(s.bar).toHaveValue("#baking ");
    await expect.poll(() => titles(page)).toEqual(["Bread", "Cake"]);
    // (Escape with the dropdown open: see repro search-tag-dropdown-escape)
    expect(pageProblems.all()).toEqual([]);
  });
});

test.describe("search: keyboard navigation of the results", () => {
  test("ArrowUp / ArrowDown / Tab / Shift+Tab move the focus, Enter opens it", async ({
    page,
    site,
    pageProblems,
  }) => {
    await blockExternalNetwork(page, site);
    await page.goto(site.url());
    await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));
    const s = await open(page);
    await s.bar.fill("bread");
    await expect(s.cards).toHaveCount(3);
    await expect.poll(() => focusedIndex(page)).toBe(0);

    await s.bar.press("ArrowUp"); // already first: stays
    await expect.poll(() => focusedIndex(page)).toBe(0);
    await s.bar.press("ArrowDown");
    await expect.poll(() => focusedIndex(page)).toBe(1);
    await s.bar.press("ArrowDown");
    await s.bar.press("ArrowDown"); // already last: stays
    await expect.poll(() => focusedIndex(page)).toBe(2);
    await s.bar.press("Shift+Tab");
    await expect.poll(() => focusedIndex(page)).toBe(1);
    await s.bar.press("ArrowUp");
    await expect.poll(() => focusedIndex(page)).toBe(0);
    await s.bar.press("Tab");
    await expect.poll(() => focusedIndex(page)).toBe(1);
    // the keyboard never leaves the search bar, and one card is focused
    await expect(s.bar).toBeFocused();
    await expect(
      page.locator(".results-container .result-card.focus"),
    ).toHaveCount(1);
    // the preview shows the focused result
    const focused = s.cards.nth(1);
    const title = (await focused.locator(".card-title").textContent())!;
    const href = (await focused.getAttribute("href"))!;
    await expect(page.locator(".preview-inner").first()).toContainText(title);

    await s.bar.press("Enter");
    await expect(page).toHaveURL(new URL(href, site.baseUrl).toString());
    await expect(page).toHaveTitle(new RegExp(`^${title}\\b`));
    await expect(s.container).not.toHaveClass(/active/);
    expect(
      await page.evaluate(() => (window as unknown as { __m?: number }).__m),
    ).toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });
});
