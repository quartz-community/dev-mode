import { test, expect } from "@playwright/test";

const BASE = "/Obsidian-TTRPG-Quartz";

test.describe("Nested Base URL / SPA Navigation (#2420, #2462)", () => {
  test.use({
    baseURL: `http://localhost:4174${BASE}`,
  });

  test("all internal links resolve to nested base-prefixed URLs", async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);

    const links = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => {
          try {
            const url = new URL(href);
            return url.origin === window.location.origin;
          } catch {
            return false;
          }
        }),
    );

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const linkPath = new URL(link).pathname;
      expect(linkPath).toMatch(new RegExp(`^${BASE}/`));
    }
  });

  test("SPA navigate across directories preserves correct URLs", async ({
    page,
  }) => {
    const responses404: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 404) responses404.push(res.url());
    });

    await page.goto(`${BASE}/docs/getting-started`);

    await page
      .locator('a[href*="features/callouts"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/features/callouts`);

    await expect(page.locator("h1")).toContainText("Callouts");
    expect(responses404).toEqual([]);
  });

  test("chained SPA navigation: home -> docs -> features -> deep", async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);

    await page
      .locator('a[href*="docs/getting-started"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/docs/getting-started`);

    await page
      .locator('a[href*="features/callouts"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/features/callouts`);

    await page
      .locator('a[href*="deep/nested/page"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/deep/nested/page`);

    const links = await page
      .locator("a.internal")
      .evaluateAll((anchors) =>
        anchors.map((a) => (a as HTMLAnchorElement).href),
      );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const linkPath = new URL(link).pathname;
      expect(linkPath).toMatch(new RegExp(`^${BASE}/`));
    }
  });

  test("browser back/forward preserves nested base prefix", async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);
    await page
      .locator('a[href*="docs/getting-started"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/docs/getting-started`);

    await page.goBack();
    await page.waitForURL(`**${BASE}/`);

    await page.goForward();
    await page.waitForURL(`**${BASE}/docs/getting-started`);
  });

  test("no 404 responses during SPA navigation chain", async ({ page }) => {
    const responses404: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 404) responses404.push(res.url());
    });

    await page.goto(`${BASE}/`);
    await page
      .locator('a[href*="docs/getting-started"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/docs/getting-started`);
    await page
      .locator('a[href*="features/callouts"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/features/callouts`);

    expect(responses404).toEqual([]);
  });

  test("graph links use nested base path", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(1000);

    const graphLinks = await page.evaluate((base) => {
      const links: string[] = [];
      document
        .querySelectorAll(".graph-outer a, #graph-container a")
        .forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          if (href && new URL(href).origin === window.location.origin) {
            links.push(new URL(href).pathname);
          }
        });
      return links;
    }, BASE);

    for (const link of graphLinks) {
      expect(link).toMatch(new RegExp(`^${BASE}/`));
    }
  });
});
