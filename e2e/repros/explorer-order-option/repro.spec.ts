import { test, expect } from "../../helpers/repro-fixture";

// quartz-community/explorer#3: `order` was serialized into the page but processTrie always ran
// filter → map → sort. A mapFn that strips Johnny.Decimal prefixes then reordered the folders.
// mapFn can only be set from TypeScript, so the spec sets it on the rendered explorer (the same
// data attribute the component writes) and re-renders it.

const stripPrefix = `(node) => { node.displayName = node.displayName.replace(/^\\d+\\s+/, ""); return node; }`;

async function rerender(page, order: string[]) {
  await page.evaluate(
    ({ order, mapFn }) => {
      const explorer = document.querySelector<HTMLElement>("div.explorer")!;
      const fns = JSON.parse(explorer.dataset.dataFns || "{}");
      explorer.dataset.dataFns = JSON.stringify({ ...fns, order, mapFn });
      document.dispatchEvent(
        new CustomEvent("render", { detail: { url: "" } }),
      );
    },
    { order, mapFn: stripPrefix },
  );
}

const folders = (page) =>
  page.locator(".explorer-ul > li.nav-folder .folder-title");

test.describe("Repro for quartz-community/explorer#3", () => {
  test("the configured order reaches the page", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    const fns = await page
      .locator("div.explorer")
      .getAttribute("data-data-fns");
    expect(JSON.parse(fns!).order).toEqual(["filter", "sort", "map"]);
    await expect(folders(page)).toHaveText(["10 Zebra", "20 Apple"]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("sort before map: folders keep their numbered order", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(folders(page)).toHaveCount(2);
    await rerender(page, ["filter", "sort", "map"]);
    await expect(folders(page)).toHaveText(["Zebra", "Apple"]);
  });

  test("map before sort (the default): folders sort by their mapped names", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(folders(page)).toHaveCount(2);
    await rerender(page, ["filter", "map", "sort"]);
    await expect(folders(page)).toHaveText(["Apple", "Zebra"]);
  });
});
