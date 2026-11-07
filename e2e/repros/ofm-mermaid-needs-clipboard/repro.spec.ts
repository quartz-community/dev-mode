import { test, expect } from "../../helpers/repro-fixture";

// repos/obsidian-flavored-markdown/src/scripts/mermaid.inline.ts does
// window.getComputedStyle(pre.querySelector(".clipboard-button")) — but that
// button is rendered by the syntax-highlighting plugin (clipboard.inline.ts).
// OFM doesn't declare the dependency, so with syntax-highlighting disabled the
// script throws: "Failed to execute 'getComputedStyle' on 'Window': parameter 1
// is not of type 'Element'". Found by `just site-smoke fixture:bug-repro`.

test.describe("Mermaid works without syntax-highlighting", () => {
  test("mermaid page has no uncaught errors", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await expect(
      page.locator("article pre code.mermaid, article .mermaid").first(),
    ).toBeAttached();
    await page.waitForLoadState("networkidle");
    expect(pageProblems.pageErrors).toEqual([]);
  });
});
