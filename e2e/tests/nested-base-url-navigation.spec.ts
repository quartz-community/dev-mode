import { test, expect } from "../helpers/coverage-fixture.js";
import {
  graphNodes,
  installGraphProbe,
  type GraphNode,
} from "../helpers/graph-probe";

// Only the local site counts: absolute production URLs (e.g. self-hosted fonts at
// https://<baseUrl>/static/fonts/…) are not served by the test server.
const isLocal = (url: string) =>
  /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url);

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
      if (res.status() === 404 && isLocal(res.url()))
        responses404.push(res.url());
    });

    await page.goto(`${BASE}/docs/getting-started`);

    await page
      .locator('a[href*="features/callouts"]')
      .and(page.locator(":visible"))
      .first()
      .click();
    await page.waitForURL(`**${BASE}/features/callouts`);

    await expect(page.locator("h1.article-title")).toContainText("Callouts");
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
      if (res.status() === 404 && isLocal(res.url()))
        responses404.push(res.url());
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

  // The graph is a PixiJS canvas with no <a> elements: a click on a node navigates with
  // `location.href = resolveBasePath(slug)`. Click a node (found through the probe) and check
  // the page it opens keeps the nested base path.
  test("graph links use nested base path", async ({ page }) => {
    await installGraphProbe(page);
    await page.goto(`${BASE}/`);
    const canvas = page.locator(".graph-container canvas");
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const inside = (n: GraphNode) =>
      n.x > box.x + 10 &&
      n.x < box.x + box.width - 10 &&
      n.y > box.y + 10 &&
      n.y < box.y + box.height - 10;

    // Until the layout settles (positions unchanged over 300 ms).
    let target: GraphNode | undefined;
    await expect
      .poll(
        async () => {
          const before = await graphNodes(page);
          await page.waitForTimeout(300);
          const after = await graphNodes(page);
          const moved = after.some((n, i) => {
            const b = before[i];
            return !b || Math.hypot(n.x - b.x, n.y - b.y) > 0.5;
          });
          target = after.find(
            (n) =>
              !["index", "/"].includes(n.id) &&
              !n.id.startsWith("tags/") &&
              inside(n),
          );
          return !moved && after.length > 1 && !!target;
        },
        { timeout: 15000 },
      )
      .toBe(true);

    await page.mouse.click(target!.x, target!.y);
    await page.waitForURL(`**${BASE}/${target!.id}`);
    expect(new URL(page.url()).pathname).toBe(`${BASE}/${target!.id}`);
  });
});
