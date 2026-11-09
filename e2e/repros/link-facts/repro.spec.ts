import { test, expect } from "../../helpers/repro-fixture";

// Link facts settled against Obsidian 1.15.0 (handed over by remark-obsidian 2.2.1's triage and
// re-probed with `just obsidian-bases-probe e2e/repros/link-facts/obsidian-vault`). Each line of
// content/sub/note.md is numbered; the assertions name the line.

test.describe("Repro: link facts as in Obsidian", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("sub/note"));
  });

  const para = (page: import("@playwright/test").Page, n: number) =>
    page.locator("article p").filter({ hasText: new RegExp(`^${n} `) });

  test("a path that is not valid percent-encoding is an external link, and the build survives", async ({
    page,
    pageProblems,
  }) => {
    for (const n of [1, 2]) {
      await expect(para(page, n).locator("a")).toHaveClass(/external/);
    }
    expect(pageProblems.all()).toEqual([]);
  });

  test("../x:y is internal, x:y is external", async ({ page }) => {
    await expect(para(page, 3).locator("a")).toHaveClass(/internal/);
    await expect(para(page, 3).locator("a")).toHaveAttribute("data-slug", "xy");
    await expect(para(page, 4).locator("a")).toHaveClass(/external/);
  });

  test("link paths are NFC: a decomposed café links to the composed file", async ({
    page,
  }) => {
    for (const n of [5, 6]) {
      await expect(para(page, n).locator("a")).toHaveAttribute(
        "data-slug",
        "café",
      );
    }
  });

  test("a block id in a Markdown link's text names the paragraph; a wikilink's does not", async ({
    page,
  }) => {
    await expect(para(page, 7)).toHaveAttribute("id", "abc");
    await expect(para(page, 7).locator("a")).toHaveText("text");
    await expect(para(page, 8).locator("a")).toHaveText("café > ^abc");
    await expect(para(page, 16).locator("a")).toHaveText("café > ^xyz");
    await expect(para(page, 16)).not.toHaveAttribute("id", /./);
    await expect(para(page, 19).locator("a")).toHaveText("al ^sss");
    await expect(para(page, 19)).not.toHaveAttribute("id", /./);
    await expect(para(page, 18)).toHaveAttribute("id", "rrr");
  });

  test("an embed names its path: decoded for a Markdown image, as written for a wikilink", async ({
    page,
  }) => {
    const alt = (n: number) => para(page, n).locator("img");
    await expect(alt(11)).toHaveAttribute("alt", "missing%20file.png");
    await expect(alt(13)).toHaveAttribute("alt", "alt");
    await expect(alt(14)).toHaveAttribute("alt", "missing pic.png");
    await expect(alt(20)).toHaveAttribute("alt", "pic.png");
    await expect(alt(21)).toHaveAttribute("alt", "caption");
    await expect(alt(24)).toHaveAttribute("alt", "pic.png");
    await expect(alt(25)).toHaveAttribute("alt", "cap");
  });
});
