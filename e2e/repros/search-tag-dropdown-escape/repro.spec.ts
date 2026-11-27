import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// search 1.1.4: Escape while the #tag dropdown is open should close only the dropdown
// (search.inline.ts handles exactly that: hideTagDropdown(); return). It closes the whole
// search instead: the search bar's handler calls preventDefault() but the keydown bubbles on to
// the document listener of registerEscapeHandler (@quartz-community/utils dom.ts), which does not
// check `defaultPrevented` and calls hideSearch().

test.describe("search: Escape with the tag dropdown open", () => {
  test.beforeEach(async ({ page, site }) => {
    await blockExternalNetwork(page, site);
    await page.goto(site.url());
    await expect(page).toHaveTitle(/^Home\b/);
  });

  test("closes only the dropdown, search stays open with the query", async ({
    page,
    pageProblems,
  }) => {
    const container = page.locator(".search-container").first();
    const bar = page.locator("input.search-bar").first();
    const dropdown = page.locator(".tag-suggestions").first();
    await page.locator("button.search-button").first().click();
    await bar.pressSequentially("#ba");
    await expect(dropdown).toBeVisible();

    await bar.press("Escape");
    await expect(dropdown).toBeHidden();
    await expect(container).toHaveClass(/active/);
    await expect(bar).toHaveValue("#ba");
    await expect(bar).toBeFocused();

    // a second Escape (no dropdown) closes search
    await bar.press("Escape");
    await expect(container).not.toHaveClass(/active/);
    expect(pageProblems.all()).toEqual([]);
  });

  test("control: Escape without the dropdown closes search", async ({
    page,
    pageProblems,
  }) => {
    const container = page.locator(".search-container").first();
    const bar = page.locator("input.search-bar").first();
    await page.locator("button.search-button").first().click();
    await bar.fill("bread");
    await expect(page.locator(".tag-suggestions").first()).toBeHidden();
    await bar.press("Escape");
    await expect(container).not.toHaveClass(/active/);
    await expect(bar).toHaveValue("");
    expect(pageProblems.all()).toEqual([]);
  });
});
