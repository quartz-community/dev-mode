import { test, expect } from "../../helpers/repro-fixture";

// canvas-page and obsidian-plugin-excalidraw render .canvas / .excalidraw(.md) files as virtual
// pages. Base views should list them as the files they stand for, as Obsidian Bases does:
// file.path is the source path, file.ext its extension ("canvas", "excalidraw", and "md" for
// an Excalidraw drawing stored as Markdown), file.folder its folder.
async function rows(
  page: import("@playwright/test").Page,
  table: number,
): Promise<string[][]> {
  const trs = page
    .locator("article .bases-inline")
    .nth(table)
    .locator("table.bases-table tbody tr");
  const result: string[][] = [];
  for (const tr of await trs.all()) {
    result.push(
      (await tr.locator("td").allTextContents()).map((t) => t.trim()),
    );
  }
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

test.describe("canvas and Excalidraw files in base views", () => {
  test("a folder base lists them with their source path, extension and folder", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url(""));
    expect(await rows(page, 0)).toEqual([
      ["Diagram", "boards/Diagram.excalidraw", "excalidraw", "boards"],
      ["Note", "boards/Note.md", "md", "boards"],
      ["Plan", "boards/Plan.canvas", "canvas", "boards"],
      ["Sketch.excalidraw", "boards/Sketch.excalidraw.md", "md", "boards"],
    ]);
    expect(pageProblems.all()).toEqual([]);
  });

  test('file.ext == "canvas" selects the canvas file', async ({
    page,
    site,
  }) => {
    await page.goto(site.url(""));
    expect(await rows(page, 1)).toEqual([["Plan", "boards/Plan.canvas"]]);
  });

  test("the rows link to the rendered canvas and drawing pages", async ({
    page,
    site,
  }) => {
    await page.goto(site.url(""));
    const links = page
      .locator("article .bases-inline")
      .nth(0)
      .locator("tbody td:first-child a");
    const hrefs = await links.evaluateAll((as) =>
      as.map((a) => (a as HTMLAnchorElement).href),
    );
    expect(hrefs).toHaveLength(4);
    for (const href of hrefs) {
      expect((await page.request.get(href)).status(), href).toBe(200);
    }
  });
});
