import { test, expect, type Page } from "../../helpers/repro-fixture";
// note-properties: the properties view (details.note-properties) remembers whether the reader
// collapsed it (localStorage), and mirrors the state as Obsidian's is-collapsed class.

const details = (page: Page) => page.locator("details.note-properties").first();
const isOpen = (page: Page) =>
  details(page).evaluate((el) => (el as HTMLDetailsElement).open);
const title = (page: Page, text: string) =>
  expect(page).toHaveTitle(new RegExp(`^${text}\\b`));

test("collapsing the properties view is remembered across reloads and pages", async ({
  page,
  site,
  pageProblems,
}) => {
  await page.goto(site.url());
  await expect(details(page)).toBeVisible();
  expect(await isOpen(page)).toBe(true);
  await expect(details(page)).not.toHaveClass(/is-collapsed/);
  await expect(details(page).getByText("Ada")).toBeVisible();

  await details(page).locator("summary").click();
  await expect.poll(() => isOpen(page)).toBe(false);
  await expect(details(page)).toHaveClass(/is-collapsed/);
  await expect(details(page).getByText("Ada")).toBeHidden();

  await page.reload();
  await title(page, "Home");
  await expect(details(page)).toHaveClass(/is-collapsed/);
  expect(await isOpen(page)).toBe(false);

  // the state is the reader's, not the page's: another note opens collapsed too
  await page.locator("article a.internal", { hasText: /^Other$/ }).click();
  await title(page, "Other");
  await expect(details(page)).toHaveClass(/is-collapsed/);
  expect(await isOpen(page)).toBe(false);

  await details(page).locator("summary").click();
  await expect.poll(() => isOpen(page)).toBe(true);
  await expect(details(page)).not.toHaveClass(/is-collapsed/);
  await expect(details(page).getByText("Grace")).toBeVisible();

  await page.reload();
  await title(page, "Other");
  await expect(details(page)).toBeVisible();
  expect(await isOpen(page)).toBe(true);
  await expect(details(page)).not.toHaveClass(/is-collapsed/);
  expect(pageProblems.all()).toEqual([]);
});
