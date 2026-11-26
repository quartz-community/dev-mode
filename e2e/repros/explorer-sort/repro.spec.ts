import { test, expect, type Page } from "../../helpers/repro-fixture";

// quartz-community/explorer#6: sort rules in quartz.config.yaml —
//   sort: [folder, { by: date, direction: desc }, title]
// Quartz core leaves `date` out of contentIndex.json (until the core change lands), so the
// date rule ties and the title decides; with dates in the index (injected here as core will
// write them, ISO strings) the newest page comes first.

const dates: Record<string, string> = {
  "posts/alpha": "2026-01-10T00:00:00.000Z",
  "posts/beta": "2026-03-05T00:00:00.000Z",
  "posts/gamma": "2025-12-24T00:00:00.000Z",
  "posts/delta": "2026-02-14T00:00:00.000Z",
  "archive/old-one": "2023-04-01T00:00:00.000Z",
  "archive/old-two": "2024-04-01T00:00:00.000Z",
  // the archive's index page: date set in its frontmatter
  "archive/index": "2027-01-01T00:00:00.000Z",
};

/** Dates as core writes them; `flag`: also `dateFromFrontmatter` (jackyzha0/quartz#2703). */
async function withDates(page: Page, flag = false) {
  await page.route("**/static/contentIndex.json", async (route) => {
    const res = await route.fetch();
    const index = await res.json();
    const content = index.content ?? index;
    for (const [slug, date] of Object.entries(dates)) {
      if (!content[slug]) continue;
      content[slug].date = date;
      if (flag && slug === "archive/index")
        content[slug].dateFromFrontmatter = true;
    }
    await route.fulfill({ response: res, json: index });
  });
}

const topFolders = (page: Page) =>
  page.locator(
    ".explorer-ul > li.nav-folder > .folder-container .folder-title",
  );
const posts = (page: Page) =>
  page.locator(
    '.folder-container[data-folderpath="posts/index"] + .folder-outer li.nav-file a',
  );

test.describe("Repro for quartz-community/explorer#6", () => {
  test("without dates in the index: the next rule (title) decides", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/posts/beta"));
    await expect(posts(page)).toHaveText(["Alpha", "Beta", "Delta", "Gamma"]);
    await expect(topFolders(page)).toHaveText(["archive", "posts"]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("with dates, older core (no dateFromFrontmatter): folders by their newest page", async ({
    page,
    site,
    pageProblems,
  }) => {
    await withDates(page);
    await page.goto(site.url("/posts/beta"));
    await expect(posts(page)).toHaveText(["Beta", "Delta", "Alpha", "Gamma"]);
    await expect(topFolders(page)).toHaveText(["posts", "archive"]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("an index page's frontmatter date dates its folder", async ({
    page,
    site,
  }) => {
    await withDates(page, true);
    await page.goto(site.url("/posts/beta"));
    await expect(topFolders(page)).toHaveText(["archive", "posts"]);
    await expect(posts(page)).toHaveText(["Beta", "Delta", "Alpha", "Gamma"]);
  });
});
