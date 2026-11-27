import { test, expect, type Page } from "../../helpers/repro-fixture";
// obsidian-flavored-markdown fold.inline.ts: heading and list folding (foldHeadings, foldLists).

const view = (page: Page) => page.locator("article > .markdown-preview-view");

/** Text of each top-level block of the note, and whether it carries data-fold-hidden. */
const blocks = (page: Page) =>
  view(page).evaluate((root) =>
    [...root.children].map((el) => [
      (el.textContent ?? "").trim().split("\n")[0],
      el.hasAttribute("data-fold-hidden"),
    ]),
  );

const indicator = (page: Page, heading: string) =>
  view(page).locator(
    `:is(h2, h3)[data-heading="${heading}"] > .heading-collapse-indicator`,
  );

const NONE_HIDDEN = [
  ["A", false],
  ["para", false],
  ["B", false],
  ["x", false],
  ["C", false],
  ["y", false],
  ["parent item", false],
  ["Other", false],
];

async function checkHeadingFold(page: Page) {
  await expect.poll(() => blocks(page)).toEqual(NONE_HIDDEN);

  await indicator(page, "A").click();
  await expect(view(page).locator("> .el-h2").first()).toHaveClass(
    /is-collapsed/,
  );
  await expect
    .poll(() => blocks(page))
    .toEqual([
      ["A", false],
      ["para", true],
      ["B", true],
      ["x", true],
      ["C", false],
      ["y", false],
      ["parent item", false],
      ["Other", false],
    ]);
  await expect(view(page).getByText("para", { exact: true })).toBeHidden();
  await expect(view(page).getByText("y", { exact: true })).toBeVisible();

  await indicator(page, "A").click();
  await expect.poll(() => blocks(page)).toEqual(NONE_HIDDEN);
  await expect(view(page).getByText("para", { exact: true })).toBeVisible();
}

test.describe("OFM folding", () => {
  test("a heading's arrow hides the blocks up to the next heading of its level", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url());
    await checkHeadingFold(page);
    expect(pageProblems.all()).toEqual([]);
  });

  test("a heading folded inside a folded section stays folded when the section opens", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await indicator(page, "B").click();
    await expect
      .poll(() => blocks(page))
      .toEqual([
        ["A", false],
        ["para", false],
        ["B", false],
        ["x", true],
        ["C", false],
        ["y", false],
        ["parent item", false],
        ["Other", false],
      ]);
    await indicator(page, "A").click();
    await indicator(page, "A").click();
    await expect
      .poll(() => blocks(page))
      .toEqual([
        ["A", false],
        ["para", false],
        ["B", false],
        ["x", true],
        ["C", false],
        ["y", false],
        ["parent item", false],
        ["Other", false],
      ]);
  });

  test("a list item's arrow hides its sublist only", async ({ page, site }) => {
    await page.goto(site.url());
    const parent = view(page)
      .locator("li", { hasText: /^parent item/ })
      .first();
    const child = view(page)
      .locator("li", { hasText: /^child item/ })
      .first();
    const arrow = parent.locator("> .list-collapse-indicator");

    await expect(child).toBeVisible();
    await arrow.click();
    await expect(parent).toHaveClass(/is-collapsed/);
    await expect(arrow).toHaveClass(/is-collapsed/);
    await expect(child).toBeHidden();
    await expect(view(page).getByText("sibling item")).toBeVisible();
    // Folding a list item hides nothing at the block level.
    await expect.poll(() => blocks(page)).toEqual(NONE_HIDDEN);

    await arrow.click();
    await expect(parent).not.toHaveClass(/is-collapsed/);
    await expect(child).toBeVisible();

    // A nested item folds on its own.
    const childArrow = child.locator("> .list-collapse-indicator");
    await childArrow.click();
    await expect(child).toHaveClass(/is-collapsed/);
    await expect(parent).not.toHaveClass(/is-collapsed/);
    await expect(view(page).getByText("grandchild item")).toBeHidden();
    await expect(child).toBeVisible();
  });

  test("folding still works after an SPA navigation away and back", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await page.evaluate(
      () => ((window as unknown as { __marker: number }).__marker = 1),
    );
    await page.locator("article a.internal", { hasText: /^Other$/ }).click();
    await expect(page).toHaveTitle(/^Other\b/);
    await page.locator("article a.internal", { hasText: /^Home$/ }).click();
    await expect(page).toHaveTitle(/^Home\b/);
    expect(
      await page.evaluate(
        () => (window as unknown as { __marker?: number }).__marker,
      ),
    ).toBe(1);
    await expect(view(page)).toHaveClass(/allow-fold-headings/);
    await expect(view(page)).toHaveClass(/allow-fold-lists/);

    await checkHeadingFold(page);
    const parent = view(page)
      .locator("li", { hasText: /^parent item/ })
      .first();
    await parent.locator("> .list-collapse-indicator").click();
    await expect(parent).toHaveClass(/is-collapsed/);
    await expect(
      view(page)
        .locator("li", { hasText: /^child item/ })
        .first(),
    ).toBeHidden();
  });
});

// callout.inline.ts: a click on a foldable callout's title toggles is-collapsed on the callout
// and its `.callout-fold` arrow (themes rotate it), and opens or closes the content.
test.describe("OFM callout fold", () => {
  async function checkCalloutFold(page: Page) {
    // `faq` is an alias of `question`.
    const callout = page.locator(
      'article .callout[data-callout="question"].is-collapsible',
    );
    const fold = callout.locator(".callout-fold");
    const content = callout.locator(".callout-content");
    await expect(callout).toHaveClass(/is-collapsed/);
    await expect(fold).toHaveClass(/is-collapsed/);
    await expect(content).toHaveAttribute("style", /grid-template-rows: 0fr/);

    await callout.locator(".callout-title").click();
    await expect(callout).not.toHaveClass(/is-collapsed/);
    await expect(fold).not.toHaveClass(/is-collapsed/);
    await expect(content).toHaveAttribute("style", /grid-template-rows: 1fr/);
    await expect(callout.getByText("The answer.")).toBeVisible();

    await callout.locator(".callout-title").click();
    await expect(callout).toHaveClass(/is-collapsed/);
    await expect(fold).toHaveClass(/is-collapsed/);
    await expect(content).toHaveAttribute("style", /grid-template-rows: 0fr/);
  }

  test("the title opens and closes a folded callout", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("other"));
    await checkCalloutFold(page);
    expect(pageProblems.all()).toEqual([]);
  });

  test("and still does after SPA navigations (one listener per title)", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("other"));
    for (const [link, title] of [
      ["Home", "Home"],
      ["Other", "Other"],
    ]) {
      await page
        .locator("article a.internal", { hasText: new RegExp(`^${link}$`) })
        .click();
      await expect(page).toHaveTitle(new RegExp(`^${title}\\b`));
    }
    await checkCalloutFold(page);
  });
});
