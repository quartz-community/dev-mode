import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";

// encrypted-pages encrypted a page only when its frontmatter password was a string: YAML reads
// `password: 1234` as a number, so the page was published in the clear (as were `[a, b]`, `true`).
//
// Expected (encrypted-pages README): "A number (`password: 1234`) is used as its string form
// (`0042` reads as `42`: quote it to keep the zeros). Any other value (a list, `true`) locks the
// page for everyone and warns at build time."

/** The page as served, before any script ran. */
async function servedHtml(page: Page, url: string): Promise<string> {
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  return res.text();
}

async function tryPassword(page: Page, password: string) {
  const input = page.locator(".encrypted-page-input");
  await expect(input).toBeEnabled();
  await input.fill(password);
  await page.locator(".encrypted-page-submit").click();
}

async function expectRejected(page: Page, password: string) {
  await tryPassword(page, password);
  await expect(page.locator(".encrypted-page-error")).toHaveText(
    /Incorrect password/,
  );
  await expect(page.locator(".encrypted-page-input")).toHaveValue("");
}

async function expectLocked(page: Page, url: string, plaintext: string) {
  const html = await servedHtml(page, url);
  expect(html).toContain("data-encrypted=");
  expect(html).not.toContain(plaintext);
  await page.goto(url);
  await expect(page.locator(".encrypted-page-input")).toBeVisible();
}

test.describe("encrypted-pages: numeric and non-text frontmatter passwords", () => {
  test("password: 1234 encrypts the page, and 1234 unlocks it", async ({
    page,
    site,
    pageProblems,
  }) => {
    await expectLocked(page, site.url("number"), "NUMBER-PLAINTEXT");
    await tryPassword(page, "1234");
    await expect(page.locator("article")).toContainText(
      "NUMBER-PLAINTEXT: unlocked with 1234.",
    );
    expect(pageProblems.all()).toEqual([]);
  });

  test("password: 0042 encrypts the page with 42 (YAML reads a number)", async ({
    page,
    site,
    pageProblems,
  }) => {
    await expectLocked(page, site.url("zeros"), "ZEROS-PLAINTEXT");
    await expectRejected(page, "0042");
    await tryPassword(page, "42");
    await expect(page.locator("article")).toContainText(
      "ZEROS-PLAINTEXT: unlocked with 42.",
    );
    expect(pageProblems.all()).toEqual([]);
  });

  test("password: [a, b] keeps the page locked for everyone, its text not in the HTML", async ({
    page,
    site,
    pageProblems,
  }) => {
    await expectLocked(page, site.url("list"), "LIST-PLAINTEXT");
    for (const guess of ["a", "b", "a,b"]) await expectRejected(page, guess);
    await expect(page.locator(".encrypted-page-input")).toBeVisible();
    await expect(page.locator("article")).not.toContainText("LIST-PLAINTEXT");
    expect(pageProblems.all()).toEqual([]);
  });
});
