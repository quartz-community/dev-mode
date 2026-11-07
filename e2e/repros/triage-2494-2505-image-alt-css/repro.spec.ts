import { test, expect } from "../../helpers/repro-fixture";
import type { Page } from "@playwright/test";

// #2494 / #2505: the snippet documented in docs/features/wikilinks.md ("Styling individual
// images"), injected because repros can't overlay quartz/styles/custom.scss.
const DOCUMENTED_CSS = `
html[saved-theme="dark"] :is(img[alt~="invert"], object[aria-label~="invert"]) {
  filter: invert(1) hue-rotate(180deg);
}
:is(img[alt~="center"], object[aria-label~="center"]) {
  display: block;
  margin-inline: auto;
}
`;

const embed = (page: Page, label: string) =>
  page.locator("article p", { hasText: `${label}:` }).locator("img, object");

async function open(page: Page, url: string, mode: "light" | "dark") {
  await page.emulateMedia({ colorScheme: mode });
  await page.goto(url);
  await page.addStyleTag({ content: DOCUMENTED_CSS });
}

test("invert flag inverts images only in dark mode, with or without a width", async ({
  page,
  site,
  pageProblems,
}) => {
  const filter = (label: string) =>
    embed(page, label).evaluate((el) => getComputedStyle(el).filter);
  await open(page, site.url("/"), "dark");
  for (const label of ["A", "B", "C", "D", "E", "F"]) {
    expect(await filter(label), label).toBe("invert(1) hue-rotate(180deg)");
  }
  expect(await filter("G")).toBe("none");
  await expect(embed(page, "B")).toHaveAttribute("width", "300");
  // Markdown image with Obsidian's size suffix: `![invert|300](diagram.png)`
  await expect(embed(page, "E")).toHaveAttribute("alt", "invert");
  await expect(embed(page, "E")).toHaveAttribute("width", "300");

  await open(page, site.url("/"), "light");
  expect(await filter("A")).toBe("none");
  expect(pageProblems.all()).toEqual([]);
});

test("center flag centers the image in the article", async ({ page, site }) => {
  await open(page, site.url("/"), "light");
  const article = (await page.locator("article").boundingBox())!;
  const centerOffset = async (label: string) => {
    const box = (await embed(page, label).boundingBox())!;
    return Math.abs(box.x + box.width / 2 - (article.x + article.width / 2));
  };
  expect(await centerOffset("C")).toBeLessThan(2);
  expect(await centerOffset("D")).toBeLessThan(2);
  expect(await centerOffset("B")).toBeGreaterThan(50); // not flagged: stays left
});
