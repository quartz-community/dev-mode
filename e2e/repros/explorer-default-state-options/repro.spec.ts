import { test, expect, type Page } from "../../helpers/repro-fixture";
// explorer options folderDefaultState: open and useSavedState: false (rendered as
// data-collapsed / data-savestate on div.explorer).

const explorer = (page: Page) => page.locator(".left.sidebar div.explorer");
const projects = (page: Page) =>
  explorer(page).locator(".folder-container", {
    has: page.locator(".folder-title", { hasText: /^Projects$/ }),
  });
const projectsOuter = (page: Page) =>
  projects(page).locator("xpath=following-sibling::div[1]");

test("control: the options reach the page", async ({ page, site }) => {
  await page.goto(site.url());
  await expect(explorer(page)).toHaveAttribute("data-collapsed", "open");
  await expect(explorer(page)).toHaveAttribute("data-savestate", "false");
  await expect(projects(page)).toBeVisible();
});

test("folderDefaultState: open — folders start open", async ({
  page,
  site,
}) => {
  await page.goto(site.url());
  await expect(projects(page)).toBeVisible();
  await expect(projectsOuter(page)).toHaveClass(/open/);
  await expect(
    explorer(page).getByRole("link", { name: "Plan" }),
  ).toBeVisible();
});

test("useSavedState: false — a folder closed before a reload is back in its default state", async ({
  page,
  site,
}) => {
  await page.goto(site.url());
  await expect(projects(page)).toBeVisible();
  const before = await projectsOuter(page).evaluate((el) =>
    el.classList.contains("open"),
  );
  await projects(page).locator(".folder-button").click();
  await expect
    .poll(() =>
      projectsOuter(page).evaluate((el) => el.classList.contains("open")),
    )
    .toBe(!before);
  expect(
    await page.evaluate(() => localStorage.getItem("fileTree")),
  ).toBeNull();
  await page.reload();
  await expect(projects(page)).toBeVisible();
  await expect
    .poll(() =>
      projectsOuter(page).evaluate((el) => el.classList.contains("open")),
    )
    .toBe(before);
});
