import { test, expect, type Page } from "../../helpers/repro-fixture";
// A page with a table of contents and backlinks (and the explorer, search, graph…) has no
// duplicate element ids: the components used to number their lists independently, and the
// TOC and the backlinks both rendered `id="list-0"`.

const duplicateIds = (page: Page) =>
  page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) {
      if (!el.id) continue;
      seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`);
  });

async function checkPage(page: Page) {
  await expect(page.locator(".toc")).toBeVisible();
  await expect(page.locator(".backlinks li a").first()).toBeVisible();
  expect(await duplicateIds(page)).toEqual([]);

  const button = page.locator(".toc button[aria-controls]").first();
  const controls = (await button.getAttribute("aria-controls"))!;
  expect(controls).toBeTruthy();
  const list = page.locator(`[id="${controls}"]`);
  await expect(list).toHaveCount(1);
  // the button controls the TOC's own list of headings
  expect(
    await list.evaluate((el) => !!el.closest(".toc") && el.tagName === "UL"),
  ).toBe(true);
  await expect(list.locator("a").first()).toBeVisible();
}

test("no duplicate ids on a page with a TOC and backlinks", async ({
  page,
  site,
  pageProblems,
}) => {
  await page.goto(site.url());
  await expect(page.locator(".toc a")).toHaveText([
    "First",
    "Second",
    "Second, deeper",
  ]);
  await checkPage(page);
  expect(pageProblems.all()).toEqual([]);
});

test("nor after an SPA navigation", async ({ page, site }) => {
  await page.goto(site.url());
  await page.locator("article a.internal", { hasText: /^Page$/ }).click();
  await expect(page).toHaveTitle(/^Page\b/);
  await expect(page.locator(".toc a")).toHaveText(["Alpha", "Beta"]);
  await checkPage(page);
});
