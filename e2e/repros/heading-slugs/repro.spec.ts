import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";

// Every link or TOC entry to a heading must reach that heading: heading ids, link anchors and
// TOC slugs all have to come from one slug function (@quartz-community/utils slugHeading).

/** hrefs of the article's same-page anchor links, excluding the headings' own "#" anchors. */
async function samePageAnchors(page: Page): Promise<string[]> {
  return page
    .locator('article a[href^="#"]:not([role="anchor"])')
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
}

/** Does the page have an element with the id named by this URL fragment? */
async function hasTarget(page: Page, hash: string): Promise<boolean> {
  return page.evaluate(
    (h) =>
      document.getElementById(decodeURIComponent(h.replace(/^#/, ""))) !== null,
    hash,
  );
}

test.describe("heading slugs: ids, links and TOC agree", () => {
  // quartz-community/github-flavored-markdown#3
  test("a heading with -- keeps GitHub's id", async ({ page, site }) => {
    await page.goto(site.url(""));
    await expect(
      page.locator("article h2", { hasText: "Range 1" }),
    ).toHaveAttribute("id", "range-1--2");
  });

  // quartz-community/crawl-links#4 (+ Obsidian's anchor form, crawl-links#10)
  test("same-page #anchor links reach their heading", async ({
    page,
    site,
  }) => {
    await page.goto(site.url(""));
    const hrefs = await samePageAnchors(page);
    expect(hrefs.length).toBe(4);
    for (const href of hrefs) {
      expect(
        await hasTarget(page, href),
        `${href} names no id on the page`,
      ).toBe(true);
    }
  });

  // quartz-community/crawl-links#10 (+ github-flavored-markdown#3 for `--`)
  test("links to another note's heading reach it", async ({ page, site }) => {
    await page.goto(site.url(""));
    const links = page.locator('article a.internal[href*="other#"]');
    const hrefs = await links.evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).href),
    );
    expect(hrefs.length).toBe(3);
    for (const href of hrefs) {
      await page.goto(href);
      const hash = new URL(href).hash;
      expect(await hasTarget(page, hash), `${href} reaches no heading`).toBe(
        true,
      );
    }
  });

  // quartz-community/table-of-contents#3
  test("every TOC entry reaches its own heading", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    const entries = await page.locator("a[data-for]").evaluateAll((els) =>
      els.map((el) => ({
        href: el.getAttribute("href")!,
        text: el.textContent!.trim(),
      })),
    );
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const { href, text } of entries) {
      const target = await page.evaluate((h) => {
        const el = document.getElementById(decodeURIComponent(h.slice(1)));
        return el ? { tag: el.tagName, text: el.textContent!.trim() } : null;
      }, href);
      expect(
        target,
        `TOC entry "${text}" (${href}) names no id`,
      ).not.toBeNull();
      // the depth-4 "Foo" is not in the TOC (maxDepth 3), so every entry targets an h2
      expect(
        target!.tag,
        `TOC entry "${text}" (${href}) reaches the wrong heading`,
      ).toBe("H2");
    }
    expect(pageProblems.all()).toEqual([]);
  });
});
