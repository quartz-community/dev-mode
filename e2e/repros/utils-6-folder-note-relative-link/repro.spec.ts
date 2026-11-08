import { test, expect } from "../../helpers/repro-fixture";

// quartz-community/utils#6: under `relative`, links to the folder note notes/topic/Topic.md
// (slug notes/topic/index) by its own file name must reach the folder page.
const cases: [page: string, linkText: string, control?: boolean][] = [
  ["notes/topic/", "self link to a section"],
  ["notes/topic/other", "back to the folder note"],
  ["notes/topic/other", "back with ./"],
  ["notes/a/source", "up and over", true], // already worked
];

for (const [from, linkText, control] of cases) {
  const title = `${from}: "${linkText}" reaches the folder note`;
  test(control ? `control: ${title}` : title, async ({ page, site }) => {
    await page.goto(site.url(from));
    const href = await page
      .locator("article a.internal", { hasText: linkText })
      .evaluate((el) => (el as HTMLAnchorElement).href);
    expect((await page.request.get(href)).status(), href).toBe(200);
    await page.goto(href);
    await expect(page.locator("article")).toContainText("Folder note body.");
    const hash = new URL(href).hash;
    if (hash) await expect(page.locator(hash)).toHaveCount(1);
  });
}
