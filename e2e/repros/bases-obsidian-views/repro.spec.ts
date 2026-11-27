import { test, expect, type Page } from "../../helpers/repro-fixture";
import type { Locator } from "@playwright/test";

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

// bases.inline.ts: the view tabs are an ARIA tablist with roving tabindex (ArrowLeft/Right wrap,
// Home/End), and each copy of a base on a page gets its own tab and panel ids.
test.describe("Bases view tabs", () => {
  const tabs = (page: Page, root = page.locator(".bases-page").first()) =>
    root.locator(".bases-view-tabs [role=tab]");

  async function expectSelected(page: Page, root: Locator, index: number) {
    const all = root.locator(".bases-view-tabs [role=tab]");
    const count = await all.count();
    for (let i = 0; i < count; i++) {
      const tab = all.nth(i);
      await expect(tab).toHaveAttribute(
        "aria-selected",
        i === index ? "true" : "false",
      );
      await expect(tab).toHaveAttribute("tabindex", i === index ? "0" : "-1");
      const panel = root.locator(`#${await tab.getAttribute("aria-controls")}`);
      if (i === index) await expect(panel).toHaveClass(/is-active/);
      else await expect(panel).not.toHaveClass(/is-active/);
    }
    await expect(all.nth(index)).toBeFocused();
  }

  test("arrow keys, Home and End move the selection; modified arrows do nothing", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("views.base"));
    const root = page.locator(".bases-page").first();
    const all = tabs(page, root);
    const count = await all.count();
    expect(count).toBeGreaterThan(2);
    await expect(all.first()).toHaveAttribute("aria-selected", "true");

    await all.first().focus();
    await page.keyboard.press("ArrowRight");
    await expectSelected(page, root, 1);
    await page.keyboard.press("End");
    await expectSelected(page, root, count - 1);
    await page.keyboard.press("ArrowRight");
    await expectSelected(page, root, 0);
    await page.keyboard.press("ArrowLeft");
    await expectSelected(page, root, count - 1);
    await page.keyboard.press("Home");
    await expectSelected(page, root, 0);

    for (const key of [
      "Control+ArrowRight",
      "Alt+ArrowRight",
      "Meta+ArrowRight",
    ]) {
      await page.keyboard.press(key);
      await expectSelected(page, root, 0);
    }
  });

  test("a base transcluded twice: unique ids, matching tab/panel pairs, independent copies", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("twice"));
    const copies = page.locator("article .bases-page");
    await expect(copies).toHaveCount(2);

    const ids = await page.evaluate(() =>
      [...document.querySelectorAll("[role=tab], [role=tabpanel]")].map(
        (el) => el.id,
      ),
    );
    expect(ids.length).toBeGreaterThan(4);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const pairs = await page.evaluate(() =>
      [...document.querySelectorAll("[role=tab]")].map((tab) => {
        const panel = document.getElementById(
          tab.getAttribute("aria-controls") ?? "",
        );
        return {
          tab: tab.id,
          panelRole: panel?.getAttribute("role"),
          labelledBy: panel?.getAttribute("aria-labelledby"),
          samePage:
            panel?.closest(".bases-page") === tab.closest(".bases-page"),
        };
      }),
    );
    for (const p of pairs) {
      expect(p).toEqual({
        tab: p.tab,
        panelRole: "tabpanel",
        labelledBy: p.tab,
        samePage: true,
      });
    }

    const first = copies.nth(0);
    const second = copies.nth(1);
    await tabs(page, second).nth(1).click();
    await expect(tabs(page, second).nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      second.locator(
        `#${await tabs(page, second).nth(1).getAttribute("aria-controls")}`,
      ),
    ).toHaveClass(/is-active/);
    // the first copy keeps its first view
    await expect(tabs(page, first).nth(0)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(tabs(page, first).nth(1)).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(
      first.locator(
        `#${await tabs(page, first).nth(0).getAttribute("aria-controls")}`,
      ),
    ).toHaveClass(/is-active/);
    await expect(
      first.locator(
        `#${await tabs(page, first).nth(1).getAttribute("aria-controls")}`,
      ),
    ).not.toHaveClass(/is-active/);
    expect(pageProblems.all()).toEqual([]);
  });
});
