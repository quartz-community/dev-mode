import { test, expect } from "../../helpers/repro-fixture";

// Obsidian 1.15.0 with the app in German (obsidian-bases-probe q5-dates-de): dates show as
// moment L / L LT in the locale, date() reads only ISO-style strings (others are empty).
test("dates display in the site's locale; non-ISO strings are not dates (bases-page#8)", async ({
  page,
  site,
  pageProblems,
}) => {
  await page.goto(site.url("probe"));
  const cells = await page
    .locator("article .bases-inline table.bases-table tbody tr td")
    .allTextContents();
  expect(cells.map((c) => c.trim())).toEqual([
    "probe",
    "05.03.2024",
    "05.03.2024 14:30",
    "05.03.2024",
    "05.03.2024 14:30",
    "",
    "5. März 2024",
    "Dienstag",
    "06.03.2024",
  ]);
  expect(pageProblems.all()).toEqual([]);
});
