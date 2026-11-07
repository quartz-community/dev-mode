import { test, expect } from "../../helpers/repro-fixture";

// Header components can be grouped into a flex row via `layout.group` +
// `layout.groups.<name>`, same as the other slots.

test.describe("flex group in the header slot", () => {
  test("search and darkmode render inside one flex group in <header>", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const group = page.locator(".page-header header > .flex-component");
    await expect(group).toHaveCount(1);
    await expect(group.locator(".search")).toHaveCount(1);
    await expect(group.locator(".darkmode")).toHaveCount(1);
    await expect(group).toHaveCSS("column-gap", "32px");
    // not also rendered in the sidebars
    await expect(page.locator(".sidebar .search")).toHaveCount(0);
  });

  test("grouped components keep working (darkmode toggle, after SPA nav)", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await page.locator('article a.internal[href*="other"]').click();
    await expect(page).toHaveURL(/other/);
    const html = page.locator("html");
    const before = await html.getAttribute("saved-theme");
    await page.locator("header .darkmode").click();
    await expect(html).not.toHaveAttribute("saved-theme", before ?? "");
    expect(pageProblems.all()).toEqual([]);
  });
});
