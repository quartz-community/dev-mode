import { test, expect, type Page } from "../../helpers/repro-fixture";
// explorer.inline.ts with folderClickBehavior: collapse — remembered folder state, row clicks,
// Obsidian's data-path, and aria-expanded on the explorer toggles.

const explorer = (page: Page) => page.locator(".left.sidebar div.explorer");
const folderRow = (page: Page, name: string) =>
  explorer(page).locator(".folder-container", {
    has: page.locator(".folder-title", { hasText: new RegExp(`^${name}$`) }),
  });
/** The folder's list of children (open = `.folder-outer.open`). */
const folderOuter = (page: Page, name: string) =>
  folderRow(page, name).locator("xpath=following-sibling::div[1]");
const title = (page: Page, text: string) =>
  expect(page).toHaveTitle(new RegExp(`^${text}\\b`));

test.describe("explorer folder state (collapse)", () => {
  test("an opened folder stays open after an SPA navigation outside it; both survive a reload", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url());
    await title(page, "Home");
    await expect(folderOuter(page, "Projects")).not.toHaveClass(/open/);
    await folderRow(page, "Projects").locator(".folder-button").click();
    await expect(folderOuter(page, "Projects")).toHaveClass(/open/);
    await expect(folderRow(page, "Projects").locator("..")).not.toHaveClass(
      /is-collapsed/,
    );

    // Other is outside Projects: nothing but the saved state keeps it open.
    await page.locator("article a.internal", { hasText: /^Other$/ }).click();
    await title(page, "Other");
    await expect(folderOuter(page, "Projects")).toHaveClass(/open/);
    await expect(
      explorer(page).getByRole("link", { name: "Plan" }),
    ).toBeVisible();

    // remembered across a reload (folders start closed)
    await page.reload();
    await title(page, "Other");
    await expect(folderOuter(page, "Projects")).toHaveClass(/open/);

    await folderRow(page, "Projects").locator(".folder-button").click();
    await expect(folderOuter(page, "Projects")).not.toHaveClass(/open/);
    await expect(folderRow(page, "Projects").locator("..")).toHaveClass(
      /is-collapsed/,
    );
    await page.reload();
    await title(page, "Other");
    await expect(
      explorer(page).locator(".folder-container").first(),
    ).toBeVisible();
    await expect(folderOuter(page, "Projects")).not.toHaveClass(/open/);
    await expect(
      explorer(page).getByRole("link", { name: "Plan" }),
    ).toBeHidden();
    expect(pageProblems.all()).toEqual([]);
  });

  test("a click on the row outside the title toggles the folder; a ctrl-click does not", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    await title(page, "Home");
    const row = folderRow(page, "Projects");
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    const x = box.x + box.width - 3;
    const y = box.y + box.height / 2;
    // the point is on the row, not on the title button or the arrow
    expect(
      await page.evaluate(
        ([px, py]) => {
          const hit = document.elementFromPoint(px, py)!;
          return !hit.closest(".folder-button, .folder-icon") &&
            !!hit.closest(".folder-container")
            ? "row"
            : hit.outerHTML.slice(0, 80);
        },
        [x, y],
      ),
    ).toBe("row");

    await page.mouse.click(x, y);
    await expect(folderOuter(page, "Projects")).toHaveClass(/open/);
    await page.mouse.click(x, y);
    await expect(folderOuter(page, "Projects")).not.toHaveClass(/open/);

    await page.keyboard.down("Control");
    await page.mouse.click(x, y);
    await page.keyboard.up("Control");
    // (the handler runs synchronously in the click: nothing to wait for)
    await expect(folderOuter(page, "Projects")).not.toHaveClass(/open/);
    await expect(row.locator("..")).toHaveClass(/is-collapsed/);
  });

  test("the desktop toggle flips aria-expanded", async ({ page, site }) => {
    await page.goto(site.url());
    const toggle = explorer(page).locator(".explorer-toggle.desktop-explorer");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      explorer(page).locator(".folder-container").first(),
    ).toBeVisible();
    await toggle.click();
    await expect(explorer(page)).toHaveClass(/collapsed/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(explorer(page)).not.toHaveClass(/collapsed/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("explorer on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the mobile toggle flips aria-expanded", async ({ page, site }) => {
    await page.goto(site.url());
    const ex = page.locator("div.explorer").first();
    const toggle = ex.locator(".explorer-toggle.mobile-explorer");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(ex).toHaveClass(/collapsed/);
    await toggle.click();
    await expect(ex).not.toHaveClass(/collapsed/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("html")).toHaveClass(/mobile-no-scroll/);
    await toggle.click();
    await expect(ex).toHaveClass(/collapsed/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("html")).not.toHaveClass(/mobile-no-scroll/);
  });
});
