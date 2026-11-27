import { test, expect, type Page } from "../../helpers/repro-fixture";
// explorer.inline.ts: Obsidian's data-path is the vault path of a file (with extension) or
// folder. Themes key folder icons and colours on it (`.nav-folder-title[data-path^="Notes"]`).

const explorer = (page: Page) => page.locator(".left.sidebar div.explorer");
const folderRow = (page: Page, name: string) =>
  explorer(page).locator(".folder-container", {
    has: page.locator(".folder-title", { hasText: new RegExp(`^${name}$`) }),
  });

test("control: file links carry the vault path", async ({ page, site }) => {
  await page.goto(site.url());
  await expect(
    explorer(page).locator('a[href$="/notes/daily-notes/2026-11-26"]'),
  ).toHaveAttribute("data-path", "Notes/Daily Notes/2026-11-26.md");
  await expect(explorer(page).locator('a[href$="/other"]')).toHaveAttribute(
    "data-path",
    "Other.md",
  );
});

test("folder rows carry the folder's vault path", async ({ page, site }) => {
  await page.goto(site.url());
  await expect(folderRow(page, "Daily Notes")).toHaveAttribute(
    "data-path",
    "Notes/Daily Notes",
  );
  await expect(folderRow(page, "Notes")).toHaveAttribute("data-path", "Notes");
});
