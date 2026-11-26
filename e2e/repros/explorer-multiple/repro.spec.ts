import { test, expect } from "../../helpers/repro-fixture";

// quartz-community/explorer#12: two explorers in the left sidebar, the second showing only the
// Notes folder (`rootFolder: Notes`). Before: no rootFolder option, the <template> ids were
// duplicated, and each instance included its own copy of the explorer script, every copy
// rendering every explorer on the page (racing each other; the last one won).

test.use({ viewport: { width: 1400, height: 900 } });

const explorers = (page) => page.locator(".sidebar.left div.explorer");
const topLevel = (explorer) =>
  explorer.locator(
    ".explorer-ul > li > .folder-container .folder-title, .explorer-ul > li.nav-file a",
  );

test.describe("Repro for quartz-community/explorer#12", () => {
  test("the second explorer shows only its root folder", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await expect(explorers(page)).toHaveCount(2);
    await expect(explorers(page).nth(0).locator("h2")).toHaveText("Explorer");
    await expect(explorers(page).nth(1).locator("h2")).toHaveText("Notes");
    await expect(topLevel(explorers(page).nth(0))).toHaveText([
      "Notes",
      "Projects",
      "About",
    ]);
    await expect(topLevel(explorers(page).nth(1))).toHaveText([
      "Daily Notes",
      "Todo",
    ]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("no duplicate ids; each list ends with its own fade marker", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(explorers(page).nth(1).locator("li.nav-file")).not.toHaveCount(
      0,
    );
    const dupes = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(dupes).toEqual([]);
    for (const i of [0, 1]) {
      const last = await explorers(page)
        .nth(i)
        .locator(".explorer-ul")
        .evaluate((ul) => ul.lastElementChild?.className);
      expect(last).toBe("overflow-end");
    }
  });

  test("a folder opens with one click, in either explorer", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    for (const i of [0, 1]) {
      const explorer = explorers(page).nth(i);
      const row = explorer.locator(".explorer-ul > li.nav-folder").first();
      await expect(row).toHaveClass(/is-collapsed/);
      await row.locator(":scope > .folder-container .folder-icon").click();
      await expect(row).not.toHaveClass(/is-collapsed/);
      await expect(row.locator(":scope > .folder-outer")).toHaveClass(/open/);
    }
  });

  test("SPA navigation re-renders both explorers", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await page.locator("article a.internal", { hasText: "Todo" }).click();
    await expect(page).toHaveURL(/Notes\/Todo$/i);
    for (const i of [0, 1]) {
      await expect(explorers(page).nth(i).locator("a.active")).toHaveText(
        "Todo",
      );
    }
    await expect(topLevel(explorers(page).nth(1))).toHaveText([
      "Daily Notes",
      "Todo",
    ]);
    expect(pageProblems.all()).toEqual([]);
  });
});
