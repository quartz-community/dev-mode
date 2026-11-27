import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// encrypted-pages: a wrong password shows the error and leaves the page locked (and is not
// remembered), and the Enter key submits the form like the Unlock button. The other encrypted
// repros only unlock with the right password and a click.

const SECRET = "The secret page, with a code block.";

const form = (page: Page) => ({
  container: page.locator(".encrypted-page"),
  input: page.locator(".encrypted-page-input"),
  submit: page.locator(".encrypted-page-submit"),
  error: page.locator(".encrypted-page-error"),
});

const sessionText = (page: Page) =>
  page.evaluate(() => JSON.stringify({ ...sessionStorage }));

async function expectLocked(page: Page) {
  const f = form(page);
  await expect(f.container).toHaveCount(1);
  await expect(f.container).toHaveAttribute("data-encrypted", /.+/);
  await expect(page.locator("article")).not.toContainText(SECRET);
  await expect(page.locator("article pre")).toHaveCount(0);
}

async function expectWrongPassword(page: Page) {
  const f = form(page);
  await expect(f.error).toBeVisible();
  await expect(f.error).toHaveText("Incorrect password. Please try again.");
  // ready for another try: cleared, focused, enabled
  await expect(f.input).toHaveValue("");
  await expect(f.input).toBeFocused();
  await expect(f.input).toBeEnabled();
  await expect(f.submit).toBeEnabled();
  await expect(f.submit).toHaveText("Unlock");
  await expectLocked(page);
}

async function expectUnlocked(page: Page) {
  await expect(page.locator("article")).toContainText(SECRET);
  await expect(page.locator("article pre")).toHaveCount(1);
  await expect(page.locator(".encrypted-page")).toHaveCount(0);
  await expect(page.locator(".encrypted-page-form")).toHaveCount(0);
}

test.describe("encrypted-pages: wrong password and the Enter key", () => {
  test.beforeEach(async ({ page, site }) => {
    await blockExternalNetwork(page, site);
  });

  test("a wrong password shows the error and the page stays locked", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("Secret"));
    const f = form(page);
    await expect(f.input).toBeVisible();
    await expect(f.error).toBeHidden();

    // with the button
    await f.input.fill("nope");
    await f.submit.click();
    await expectWrongPassword(page);

    // and with Enter
    await f.input.fill("hunter3");
    await f.input.press("Enter");
    await expect(f.input).toHaveValue("");
    await expectWrongPassword(page);

    // neither attempt was remembered: a reload is still locked
    expect(await sessionText(page)).not.toMatch(/nope|hunter3/);
    await page.reload();
    await expect(form(page).input).toBeVisible();
    await page.waitForTimeout(500);
    await expectLocked(page);
    expect(pageProblems.all()).toEqual([]);
  });

  test("Enter with an empty password does nothing", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("Secret"));
    const f = form(page);
    await f.input.focus();
    await f.input.press("Enter");
    await page.waitForTimeout(300);
    await expect(f.error).toBeHidden();
    await expect(f.submit).toHaveText("Unlock");
    await expectLocked(page);
    expect(pageProblems.all()).toEqual([]);
  });

  test("Enter unlocks with the right password, after a wrong one", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("Secret"));
    const f = form(page);
    await f.input.fill("nope");
    await f.input.press("Enter");
    await expectWrongPassword(page);

    await f.input.fill("hunter2");
    await f.input.press("Enter");
    await expectUnlocked(page);
    expect(await sessionText(page)).toContain("hunter2");
    expect(await sessionText(page)).not.toContain("nope");

    // remembered for the session: an SPA navigation away and back unlocks by itself
    await page.locator("article a.internal", { hasText: "Normal" }).click();
    await page.waitForURL(/\/normal$/);
    await page.locator("article a.internal", { hasText: "Secret" }).click();
    await page.waitForURL(/\/secret$/);
    await expectUnlocked(page);
    expect(pageProblems.all()).toEqual([]);
  });
});
