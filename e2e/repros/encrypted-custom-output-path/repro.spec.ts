import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";

// encrypted-pages wrote the shadow content index to `outputPath`, but its browser script always
// fetched `static/encryptedContentIndex.json`: with a custom `outputPath` an unlocked unlisted
// page never appeared in graph, explorer or search.
//
// Expected: under the base path /sub with `outputPath: data/shadow.json`, unlocking the unlisted
// page fetches /sub/data/shadow.json and the page shows in the explorer and in search.

const TITLE = "Hidden Treasure";

function recordShadowFetches(page: Page) {
  const fetched: { path: string; status: number }[] = [];
  page.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (/shadow\.json$|encryptedContentIndex\.json$/.test(path))
      fetched.push({ path, status: res.status() });
  });
  return fetched;
}

const explorerEntry = (page: Page) =>
  page.locator(".explorer a", { hasText: TITLE });

async function searchTitles(page: Page, query: string): Promise<string[]> {
  await page.locator("button.search-button").first().click();
  const bar = page.locator("input.search-bar").first();
  await expect(bar).toBeVisible();
  await bar.fill(query);
  // results render after a debounce; wait for the result list to settle
  await page.waitForTimeout(600);
  const titles = await page
    .locator(".results-container .result-card:not(.no-match)")
    .allTextContents();
  await page.keyboard.press("Escape");
  return titles;
}

test.describe("encrypted-pages: custom shadow index outputPath under a base path", () => {
  test("control: the shadow index is emitted at /sub/data/shadow.json; the page is unlisted", async ({
    page,
    site,
  }) => {
    expect(new URL(site.baseUrl).pathname).toBe("/sub");
    const res = await page.request.get(site.url("data/shadow.json"));
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain(TITLE);

    await page.goto(site.url("public"));
    await expect(page.locator(".explorer")).toBeVisible();
    await expect(
      page.locator(".explorer a", { hasText: "Public" }),
    ).toBeVisible();
    await expect(explorerEntry(page)).toHaveCount(0);
    expect((await searchTitles(page, "Treasure")).join("\n")).not.toContain(
      TITLE,
    );
  });

  test("after unlocking, the page is fetched from outputPath and shows in explorer and search", async ({
    page,
    site,
    pageProblems,
  }) => {
    const fetched = recordShadowFetches(page);
    await page.goto(site.url("hidden"));
    await page.locator(".encrypted-page-input").fill("hunter2");
    await page.locator(".encrypted-page-submit").click();
    await expect(page.locator("article")).toContainText(
      "The text of the hidden page.",
    );

    await expect
      .poll(() => fetched, { message: "shadow index requests" })
      .toContainEqual({ path: "/sub/data/shadow.json", status: 200 });
    expect(fetched.filter((f) => f.path !== "/sub/data/shadow.json")).toEqual(
      [],
    );

    await expect(explorerEntry(page)).toBeVisible();
    expect((await searchTitles(page, "Treasure")).join("\n")).toContain(TITLE);
    expect(pageProblems.all()).toEqual([]);
  });
});
