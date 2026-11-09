import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";

// See README.md. diagramRenderer: pele, served under the base path /pele-site.

const PELE_DIR = "static/plugins/obsidian-flavored-markdown/pele/";

function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => urls.push(req.url()));
  return urls;
}

const pele = (urls: string[]) => urls.filter((u) => u.includes(PELE_DIR));
const cdn = (urls: string[]) =>
  urls.filter((u) => u.includes("cdn.jsdelivr.net/npm/pele"));

test.describe("ofm diagramRenderer: pele", () => {
  test("a page without Mermaid fences never downloads Pele", async ({
    page,
    site,
    pageProblems,
  }) => {
    const urls = recordRequests(page);
    await page.goto(site.url("/"));
    await expect(page.locator("article")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(pele(urls)).toEqual([]);
    expect(cdn(urls)).toEqual([]);
    expect(pageProblems.all()).toEqual([]);
  });

  test("diagrams render via the self-hosted asset, fetching only the needed diagram types", async ({
    page,
    site,
    pageProblems,
  }) => {
    const urls = recordRequests(page);
    await page.goto(site.url("diagrams"));
    await expect(page.locator("code.mermaid svg")).toHaveCount(2);
    await page.waitForLoadState("networkidle");

    expect(cdn(urls)).toEqual([]);
    expect(pele(urls).some((u) => u.endsWith(`${PELE_DIR}lazy.js`))).toBe(true);
    expect(
      pele(urls).every((u) => new URL(u).pathname.startsWith("/pele-site/")),
    ).toBe(true);
    // Chunks are per diagram type: nothing for diagram types that aren't on the page.
    expect(pele(urls).some((u) => u.includes("/diagrams/gantt"))).toBe(false);
    expect(pageProblems.all()).toEqual([]);
  });

  test("nested pages and SPA navigation resolve the asset URL correctly", async ({
    page,
    site,
    pageProblems,
  }) => {
    const urls = recordRequests(page);
    await page.goto(site.url("/"));
    await page
      .locator('article a.internal[data-slug="nested/deeper/deep-diagram"]')
      .click();
    await expect(page.locator("code.mermaid svg")).toHaveCount(1);
    await page.goto(site.url("nested/deeper/deep-diagram"));
    await expect(page.locator("code.mermaid svg")).toHaveCount(1);
    expect(
      pele(urls).every((u) =>
        new URL(u).pathname.startsWith(`/pele-site/${PELE_DIR}`),
      ),
    ).toBe(true);
    expect(pageProblems.all()).toEqual([]);
  });

  test("reopening the expand popup leaves one toolbar; the button shows on keyboard focus", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("diagrams"));
    await expect(page.locator("code.mermaid svg")).toHaveCount(2);
    const pre = page.locator("pre:has(code.mermaid)").first();
    const expand = pre.locator(".expand-button");
    const popup = pre.locator("#mermaid-container");

    for (let i = 0; i < 2; i++) {
      await pre.hover();
      await expand.click();
      await expect(popup).toHaveClass(/active/);
      await expect(popup.locator(".mermaid-content svg")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(popup).not.toHaveClass(/active/);
    }
    await pre.hover();
    await expand.click();
    await expect(popup.locator(".mermaid-controls")).toHaveCount(1);
    await page.keyboard.press("Escape");

    await page.mouse.move(0, 0);
    await expand.focus();
    await expect
      .poll(() => expand.evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
  });
});
