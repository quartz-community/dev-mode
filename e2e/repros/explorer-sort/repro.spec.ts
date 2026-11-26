import { test, expect, type Page } from "../../helpers/repro-fixture";

// quartz-community/explorer#6: sort rules in quartz.config.yaml —
//   sort: [folder, { by: date, direction: desc }, title]
// Quartz core writes each page's `date` to contentIndex.json, with `dateFromFrontmatter` when
// the date comes from the page's frontmatter (jackyzha0/quartz#2703, #2709). Every page here
// has a frontmatter date. Older cores are simulated by rewriting the index the browser gets:
// without dates the date rule ties and the title decides; with dates but no
// `dateFromFrontmatter`, a folder sorts by its newest page, not by its index page's date.

type Entry = { date?: string; dateFromFrontmatter?: boolean };

/** Serve contentIndex.json with `edit` applied to every entry. */
async function rewriteIndex(page: Page, edit: (entry: Entry) => void) {
  await page.route("**/static/contentIndex.json", async (route) => {
    const res = await route.fetch();
    const index = await res.json();
    const content: Record<string, Entry> = index.content ?? index;
    for (const entry of Object.values(content)) edit(entry);
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
  test("newest first; an index page's frontmatter date dates its folder", async ({
    page,
    site,
    pageProblems,
  }) => {
    // the premise: core writes the frontmatter dates and flags them
    const index = await (
      await page.request.get(site.url("/static/contentIndex.json"))
    ).json();
    const content: Record<string, Entry> = index.content ?? index;
    for (const slug of ["posts/beta", "archive/index"]) {
      expect(content[slug].date, slug).toBeTruthy();
      expect(content[slug].dateFromFrontmatter, slug).toBe(true);
    }

    await page.goto(site.url("/posts/beta"));
    await expect(posts(page)).toHaveText(["Beta", "Delta", "Alpha", "Gamma"]);
    // archive/index.md is dated 2027-01-01, after every post
    await expect(topFolders(page)).toHaveText(["archive", "posts"]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("without dates in the index (older core): the next rule (title) decides", async ({
    page,
    site,
    pageProblems,
  }) => {
    await rewriteIndex(page, (entry) => {
      delete entry.date;
      delete entry.dateFromFrontmatter;
    });
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
    await rewriteIndex(page, (entry) => {
      delete entry.dateFromFrontmatter;
    });
    await page.goto(site.url("/posts/beta"));
    await expect(posts(page)).toHaveText(["Beta", "Delta", "Alpha", "Gamma"]);
    // posts/beta (2026-03-05) is newer than archive's pages (2024-04-01 at most)
    await expect(topFolders(page)).toHaveText(["posts", "archive"]);
    expect(pageProblems.all()).toEqual([]);
  });
});
