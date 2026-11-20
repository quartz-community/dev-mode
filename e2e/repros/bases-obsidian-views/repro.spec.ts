import { test, expect } from "../../helpers/repro-fixture";

// Bases views and grouping as Obsidian 1.15.1 shows them (obsidian-bases-probe, parity survey
// vault v2): kanban, groupOrder, the group without a value ("None"), list options, rowHeight.

const view = (index: number) => `div.bases-view[data-view-index="${index}"]`;

test.describe("Bases views and grouping match Obsidian", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("views.base"));
  });

  test("control: renders without errors", async ({ page, pageProblems }) => {
    await expect(page.locator(view(0))).toBeAttached();
    expect(pageProblems.all()).toEqual([]);
  });

  test("kanban: a column per group, None first, columnWidth", async ({
    page,
  }) => {
    const headers = page.locator(`${view(0)} .bases-board-column-header`);
    await expect(headers).toHaveText([/^None\s*1$/, /^A\s*2$/, /^B\s*1$/]);
    await expect(
      page.locator(`${view(0)} .bases-board-column`).first(),
    ).toHaveCSS("width", "300px");
  });

  test("groupOrder: only the listed groups, in order (null: None)", async ({
    page,
  }) => {
    await expect(
      page.locator(`${view(1)} .bases-table-group-label`),
    ).toHaveText(["A", "None"]);
  });

  test("list markers and separator", async ({ page }) => {
    await expect(page.locator(`${view(2)} .bases-list-item`)).toHaveText([
      "1.Four | 1",
      "2.One | A | 5",
      "3.Three | A | 8",
      "4.Two | B | 3",
    ]);
  });

  test("a grouped list has headings, None last", async ({ page }) => {
    await expect(page.locator(`${view(3)} .bases-group-value`)).toHaveText([
      "A",
      "B",
      "None",
    ]);
  });

  test("rowHeight: tall rows are 120px", async ({ page }) => {
    await page.locator(`.bases-view-tabs >> text=Tall`).first().click();
    const cell = page.locator(`${view(4)} tbody tr td`).first();
    await expect(cell).toBeVisible();
    expect((await cell.boundingBox())?.height).toBeGreaterThanOrEqual(119);
  });
});
