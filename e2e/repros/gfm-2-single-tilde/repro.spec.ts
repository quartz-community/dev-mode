import { test, expect } from "../../helpers/repro-fixture";

// With `singleTilde: false`, only `~~text~~` strikes text: a `~` meaning "about" stays as written.

test.describe("single-tilde strikethrough can be turned off (github-flavored-markdown#2)", () => {
  test("control: ~~text~~ still strikes", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    await expect(page.locator("article del")).toHaveText(["two tildes"]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("~text~ is left as written", async ({ page, site }) => {
    await page.goto(site.url(""));
    await expect(page.locator("article p", { hasText: "about" })).toHaveText(
      "about ~20 W here and (~€120) there",
    );
    await expect(
      page.locator("article p", { hasText: "one tilde" }),
    ).toContainText("~one tilde~");
  });
});
