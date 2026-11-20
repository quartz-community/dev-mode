import { test, expect, type Page } from "../../helpers/repro-fixture";

// Discord report: custom summaries (Add summary → a formula under the base's top-level
// `summaries:`) render only their name in Quartz, e.g. "total pages" for
// `total pages: values.reduce(acc + value, 0)`.
//
// Expected values are what Obsidian 1.15.1 shows for content/Books.base
// (just obsidian-bases-probe e2e/repros/bases-custom-summaries/content). Each summary cell reads
// "<label> <value>", as in Obsidian's footer: the summary's name, then its value.

type Cells = (string | RegExp)[];

const cell = (label: string, value: string) =>
  new RegExp(`^\\s*${escape(label)}\\s*${escape(value)}\\s*$`);
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function footer(page: Page, viewIndex: number) {
  return page.locator(
    `div.bases-view[data-view-index="${viewIndex}"] tfoot td`,
  );
}

async function expectFooter(page: Page, viewIndex: number, cells: Cells) {
  await expect(await footer(page, viewIndex)).toHaveText(cells);
}

test.describe("custom and built-in Bases summaries match Obsidian", () => {
  test.beforeEach(async ({ page, site }) => {
    await page.goto(site.url("books.base"));
  });

  test("control: page renders without errors, with a summary row", async ({
    page,
    pageProblems,
  }) => {
    await expect(page.locator("div.bases-view tfoot").first()).toBeAttached();
    expect(pageProblems.all()).toEqual([]);
  });

  test("the reporter's custom summary is evaluated (Empty: values holds the draft's null)", async ({
    page,
  }) => {
    await expectFooter(page, 0, [
      cell("total pages", "Empty"),
      cell("Filled", "6"),
      cell("Empty", "0"),
    ]);
  });

  test("custom summaries without null values", async ({ page }) => {
    // Known pages: filter pages > 0. Unknown names (also lowercase built-ins) show Empty.
    await expectFooter(page, 9, [
      cell("total pages", "415"),
      cell("first plus rest", "414.5"),
      cell("undefined name", "Empty"),
      cell("unique", "Empty"),
    ]);
    // reduce's index is 0-based: 80 * 100 + 96 + 64 + 64 + 111
    await expectFooter(page, 10, [
      cell("first plus rest", "8335"),
      cell("Average", "3.7"),
    ]);
  });

  test("custom summaries: filter, mean, values, list display, errors", async ({
    page,
  }) => {
    await expectFooter(page, 5, [
      cell("long books", "3"),
      cell("mean rounded", "3.1"),
      cell("how many values", "6"),
      cell("as list", "Orwell, Swift, Orwell, Swift, Doyle, Doyle"),
      cell("broken", 'Error: Cannot find function "nope" on type List'),
    ]);
    await expectFooter(page, 6, [cell("first plus rest", "Empty")]);
  });

  test("built-in summaries: values, rounding, empty values and dates", async ({
    page,
  }) => {
    await expectFooter(page, 1, [
      cell("Sum", "415"),
      cell("Average", "3.08"), // empty values count: 18.5 / 6
      cell("Checked", "3"),
      /^\s*Earliest\s*2023-11-20/,
      cell("Unique", "3"),
    ]);
    await expectFooter(page, 2, [
      cell("Median", "80"),
      cell("Stddev", "0.87"),
      cell("Unchecked", "2"),
      /^\s*Latest\s*2025-01-15/,
      cell("Filled", "6"),
    ]);
    await expectFooter(page, 3, [
      cell("Min", "64"),
      cell("Max", "5"),
      cell("Range", "a year"),
      cell("Empty", "0"),
    ]);
    await expectFooter(page, 4, [
      cell("Range", "47"),
      cell("Median", "4"),
      cell("Unique", "3"),
    ]);
  });

  test("edge cases: unrounded custom numbers, nothing to summarise, dates in values", async ({
    page,
  }) => {
    await expectFooter(page, 11, [
      cell("raw mean", "69.16666666666667"), // custom: not rounded; mean() counts empty values
      cell("float noise", "20.35"),
      cell("Sum", "Empty"), // no values at all
      cell("Average", "Empty"), // text
      cell("Unique", "5"), // an empty value counts as one value
    ]);
    await expectFooter(page, 12, [
      cell("Stddev", "18.35"),
      cell("Range", "2.5"),
      cell("Earliest", "Empty"),
      cell("uniques", "Orwell, Swift, Doyle"),
      cell(
        "sorted",
        "2023-11-20, 2024-03-05, 2024-07-01, 2025-01-15, null, null",
      ),
    ]);
    await expectFooter(page, 13, [
      cell("first date", "2024-03-05"),
      cell("Filled", "Empty"),
      cell("Max", "Empty"),
    ]);
  });

  test("a grouped table has a summary row per group, and one for the whole table", async ({
    page,
  }) => {
    const view = page.locator('div.bases-view[data-view-index="7"]');
    const rows = view.locator(".bases-summary-row");
    // groups by author, ascending: Doyle (has the null), Orwell, Swift; then the whole table
    await expect(rows).toHaveText([
      /total pages\s*Empty/,
      /total pages\s*144/,
      /total pages\s*160/,
      /total pages\s*Empty/,
    ]);
  });

  test("an embedded base evaluates custom summaries too", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    await expect(
      page.locator("article .bases-inline tfoot td").first(),
    ).toHaveText(cell("total pages", "Empty"));
  });
});
