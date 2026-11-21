import { test, expect } from "../../helpers/repro-fixture";
// #2643: prettyLinks drops the folder from a wikilink's text, but not when the note's name has a
// space or a non-ASCII letter: the text was compared with the percent-encoded href.
test.describe("jackyzha0/quartz#2643 pretty links for encoded names", () => {
  test("wikilinks read as the note's name, without the folder", async ({
    page,
    site,
  }) => {
    await page.goto(site.url());
    const links = page.locator(".markdown-rendered li a.internal");
    await expect(links).toHaveText([
      "Name With Space",
      "NoSpace",
      "Übersicht",
      "own text",
    ]);
  });
});
