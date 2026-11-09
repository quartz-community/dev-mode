import type { Page, Request } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";

/**
 * Prefetching (`configuration.prefetch`), shared by the four core-prefetch repros:
 * - "viewport": SPA, the default — links on screen are fetched, then a click uses the page
 * - "hover":    SPA — nothing until a link is pointed at
 * - "off":      nothing is ever fetched ahead
 * - "no-spa":   SPA off — the browser is asked to prefetch (Speculation Rules in Chromium)
 *
 * content/index.md: Alpha and Beta are on screen, a PNG link too, and Far is far below the fold.
 */
export type PrefetchVariant = "viewport" | "hover" | "off" | "no-spa";

/** Same-origin fetch() requests per path ("/alpha"), as the router and prefetcher make them. */
function countFetches(page: Page) {
  const counts = new Map<string, number>();
  page.on("request", (req: Request) => {
    if (req.resourceType() !== "fetch") return;
    const url = new URL(req.url());
    counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
  });
  return (path: string) => counts.get(path) ?? 0;
}

// (`article` also matches a popover's copy of a page, appended at the end of the body)

// the prefetcher waits for an idle moment, then fetches two at a time
const settle = (page: Page) => page.waitForTimeout(1500);

export function prefetchCases(variant: PrefetchVariant, slug: string) {
  test.describe(`prefetch: ${variant}`, () => {
    test.use({ reproSlug: slug });

    if (variant === "viewport") {
      test("links on screen are fetched ahead; files and links off screen are not", async ({
        page,
        site,
        pageProblems,
      }) => {
        const fetches = countFetches(page);
        await page.goto(site.url("/"));
        await expect.poll(() => fetches("/alpha")).toBe(1);
        await expect.poll(() => fetches("/beta")).toBe(1);
        await settle(page);
        expect(fetches("/far")).toBe(0);
        expect(fetches("/pic.png")).toBe(0);
        // a link to a page the site doesn't have (not in the content index) logs no 404
        expect(fetches("/missing")).toBe(0);
        expect(pageProblems.all()).toEqual([]);
      });

      test("following a prefetched link fetches nothing more", async ({
        page,
        site,
      }) => {
        const fetches = countFetches(page);
        await page.goto(site.url("/"));
        await expect.poll(() => fetches("/alpha")).toBe(1);
        await page.locator("article a", { hasText: "Alpha" }).click();
        await expect(page).toHaveURL(/\/alpha$/);
        await expect(page.locator("article").first()).toContainText(
          "This is Alpha.",
        );
        expect(fetches("/alpha")).toBe(1);
      });

      test("a link scrolled into view is fetched then", async ({
        page,
        site,
      }) => {
        const fetches = countFetches(page);
        await page.goto(site.url("/"));
        await settle(page);
        expect(fetches("/far")).toBe(0);
        await page
          .locator("article a", { hasText: "Far" })
          .scrollIntoViewIfNeeded();
        await expect.poll(() => fetches("/far")).toBe(1);
      });

      test("a popover uses the prefetched page", async ({ page, site }) => {
        const fetches = countFetches(page);
        await page.goto(site.url("/"));
        await expect.poll(() => fetches("/beta")).toBe(1);
        await page.locator("article a", { hasText: "Beta" }).hover();
        await expect(page.locator(".popover.active-popover")).toContainText(
          "This is Beta.",
        );
        expect(fetches("/beta")).toBe(1);
      });
    }

    if (variant === "hover") {
      test("nothing is fetched until a link is pointed at, then a click uses it", async ({
        page,
        site,
      }) => {
        const fetches = countFetches(page);
        await page.goto(site.url("/"));
        await settle(page);
        expect(fetches("/alpha")).toBe(0);
        await page.locator("article a", { hasText: "Alpha" }).hover();
        await expect.poll(() => fetches("/alpha")).toBe(1);
        await page.locator("article a", { hasText: "Alpha" }).click();
        await expect(page.locator("article").first()).toContainText(
          "This is Alpha.",
        );
        expect(fetches("/alpha")).toBe(1);
        expect(fetches("/beta")).toBe(0);
      });
    }

    if (variant === "off") {
      test("nothing is fetched ahead", async ({ page, site }) => {
        const fetches = countFetches(page);
        await page.goto(site.url("/"));
        await settle(page);
        expect(await page.evaluate(() => "quartzPrefetch" in window)).toBe(
          false,
        );
        expect(fetches("/alpha") + fetches("/beta")).toBe(0);
        await page.locator("article a", { hasText: "Alpha" }).click();
        await expect(page.locator("article").first()).toContainText(
          "This is Alpha.",
        );
        // (without the prefetch cache the popover and the router each fetch it, as before)
        expect(fetches("/alpha")).toBeGreaterThanOrEqual(1);
      });
    }

    if (variant === "no-spa") {
      test("without SPA routing the browser is asked to prefetch the links on screen", async ({
        page,
        site,
        pageProblems,
      }) => {
        await page.goto(site.url("/"));
        await settle(page);
        const hinted = await page.evaluate(() => [
          ...[
            ...document.querySelectorAll('script[type="speculationrules"]'),
          ].flatMap(
            (s) =>
              (JSON.parse(s.textContent ?? "{}").prefetch ?? []).flatMap(
                (rule: { urls?: string[] }) => rule.urls ?? [],
              ) as string[],
          ),
          ...[
            ...document.querySelectorAll<HTMLLinkElement>(
              'link[rel="prefetch"]',
            ),
          ].map((l) => l.href),
        ]);
        const paths = hinted.map((u) => new URL(u).pathname).sort();
        expect(paths).toEqual(["/alpha", "/beta"]);
        expect(pageProblems.all()).toEqual([]);
        // a click is a normal page load (it may cancel a popover's fetch, as without prefetching)
        await page.locator("article a", { hasText: "Alpha" }).click();
        await expect(page.locator("article").first()).toContainText(
          "This is Alpha.",
        );
      });
    }
  });
}
