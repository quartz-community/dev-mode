import { test, expect } from "../../helpers/repro-fixture";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// quartz-community/bases-page#11: with explicit-publish, .base / .canvas / Excalidraw files were
// published whether or not anything opted them in, and their pages could not be encrypted.
//
// Expected: a file with frontmatter (Drawing.excalidraw.md) follows its own `publish:` like a note;
// a file without frontmatter (.base, .canvas) gets a page when a published note links to it, and
// is encrypted with that note's password when the note is encrypted. A base embedded in a
// published note renders inside it either way.

const unpublished = [
  "secret.base", // referenced by nothing
  "secret.canvas",
  "drafts/private.base", // referenced only by an unpublished note
  "drafts/private.canvas",
  "boards/hidden.excalidraw", // has frontmatter, but no publish: true
];

function contentIndex(
  dir: string,
): Record<string, { title: string; filePath: string }> {
  return JSON.parse(
    readFileSync(join(dir, "static/contentIndex.json"), "utf-8"),
  );
}

test.describe("quartz-community/bases-page#11 bases, canvases and drawings follow publish filters", () => {
  test("control: published note renders, with its embedded base", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await expect(page.locator("article .bases-inline table")).toBeVisible();
    expect(pageProblems.all()).toEqual([]);
  });

  test("control: opted-in canvas and drawing are published", async ({
    page,
    site,
  }) => {
    for (const slug of ["linked.canvas", "boards/drawing.excalidraw"]) {
      const res = await page.request.get(site.url(slug));
      expect(res.status(), slug).toBe(200);
      expect(Object.keys(contentIndex(site.dir))).toContain(slug);
    }
  });

  test("unpublished bases, canvases and drawings have no page", async ({
    page,
    site,
  }) => {
    for (const slug of unpublished) {
      const res = await page.request.get(site.url(slug));
      expect(res.status(), slug).toBe(404);
    }
  });

  test("unpublished files are not listed (content index, folder page)", async ({
    page,
    site,
  }) => {
    const index = contentIndex(site.dir);
    for (const slug of unpublished)
      expect(Object.keys(index), slug).not.toContain(slug);

    await page.goto(site.url("boards/"));
    await expect(page.locator(".page-listing")).toContainText("Drawing");
    await expect(page.locator(".page-listing")).not.toContainText("Hidden");
  });

  test("a base that is only embedded gets no page of its own", async ({
    page,
    site,
  }) => {
    const res = await page.request.get(site.url("shared.base"));
    expect(res.status()).toBe(404);
  });

  test("a canvas linked from an encrypted note is encrypted with it", async ({
    page,
    site,
  }) => {
    const res = await page.request.get(site.url("locked.canvas"));
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("locked canvas text");
    expect(html).toContain("data-encrypted");
    const entry = contentIndex(site.dir)["locked.canvas"];
    expect(JSON.stringify(entry ?? {})).not.toContain("locked canvas text");
  });

  test("the encrypted canvas opens with the note's password", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("locked.canvas"));
    await page.locator(".encrypted-page-input").fill("hunter2");
    await page.locator(".encrypted-page-submit").click();
    await expect(page.locator(".canvas-container")).toContainText(
      "locked canvas text",
    );
  });
});
