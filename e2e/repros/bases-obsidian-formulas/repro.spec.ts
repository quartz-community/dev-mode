import { test, expect } from "../../helpers/repro-fixture";

// Bases formulas that render something (html(), icon(), image()), regular expressions and the
// link columns, as Obsidian 1.15.1 shows them (obsidian-bases-probe, parity survey).

test.describe("Bases formulas render as in Obsidian", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("formulas.base"));
  });

  test("control: renders without errors", async ({ page, pageProblems }) => {
    await expect(page.locator("table.bases-table tbody tr")).toHaveCount(2);
    expect(pageProblems.all()).toEqual([]);
  });

  test("html(), icon() and image() render, not show as text", async ({
    page,
  }) => {
    const alpha = page.locator("table.bases-table tbody tr").first();
    await expect(alpha.locator("td").nth(1).locator("b")).toHaveText("bold");
    await expect(
      alpha.locator("td").nth(2).locator("svg.lucide-star"),
    ).toBeAttached();
    const img = alpha.locator("td").nth(3).locator("img");
    await expect(img).toHaveAttribute("src", /attachments\/dot\.png$/);
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test("regular expressions", async ({ page }) => {
    const cells = page.locator("table.bases-table tbody tr td:nth-child(5)");
    await expect(cells).toHaveText(["A.", "B."]);
  });

  test("file.links (without tags) and file.backlinks show notes by name", async ({
    page,
  }) => {
    const rows = page.locator("table.bases-table tbody tr");
    await expect(rows.nth(0).locator("td").nth(5)).toHaveText("Beta");
    await expect(rows.nth(1).locator("td").nth(6)).toHaveText("Alpha");
  });

  test("file.properties.keys() is the frontmatter as written (no title)", async ({ page }) => {
    const cell = page
      .locator("table.bases-table tbody tr")
      .first()
      .locator("td")
      .nth(7);
    await expect(cell).toHaveText("status");
  });
});
