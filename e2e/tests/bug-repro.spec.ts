import { test, expect } from "@playwright/test";

const BASE = "/bug-repro";
const ORIGIN = `http://localhost:4175`;

test.describe("Bug Reproductions", () => {
  test.use({ baseURL: ORIGIN });

  test.describe("#2437 — Callout body text leaks into title", () => {
    test("nested callout with bold text keeps body separate from title", async ({
      page,
    }) => {
      await page.goto(`${BASE}/features/callouts`);

      const infoCallout = page.locator('.callout[data-callout="info"]');
      await expect(infoCallout).toBeVisible();

      const titleText = await infoCallout
        .locator(".callout-title-inner")
        .textContent();

      expect(titleText?.trim()).toBe("Dosage");

      const hasContent =
        (await infoCallout.locator(".callout-content").count()) > 0;
      expect(hasContent).toBe(true);
    });
  });

  test.describe("#2436 — Collapsible callouts cannot be collapsed", () => {
    test("clicking collapsible callout toggles content visibility", async ({
      page,
    }) => {
      await page.goto(`${BASE}/features/callouts`);

      const collapsible = page.locator('.callout[data-callout="example"]');
      if ((await collapsible.count()) === 0) {
        test.skip();
        return;
      }

      const content = collapsible.locator(".callout-content");
      await expect(content).toBeVisible();

      await collapsible.locator(".callout-title").click();
      await page.waitForTimeout(300);

      const isCollapsed = await collapsible.evaluate(
        (el) =>
          el.classList.contains("is-collapsed") ||
          el.hasAttribute("data-collapsed"),
      );
      expect(isCollapsed).toBe(true);
    });
  });

  test.describe("#2450 — Custom callouts have no background style", () => {
    test("custom callout type has background color applied", async ({
      page,
    }) => {
      await page.goto(`${BASE}/features/callouts`);

      const customCallout = page.locator('.callout[data-callout="foo"]');
      if ((await customCallout.count()) === 0) {
        test.skip();
        return;
      }

      const bgColor = await customCallout.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.backgroundColor;
      });

      expect(bgColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(bgColor).not.toBe("transparent");
    });
  });

  test.describe("#2407 — Pages with dashes fail with note-properties", () => {
    test("why-go.md loads correctly with note-properties enabled", async ({
      page,
    }) => {
      const response = await page.goto(`${BASE}/features/why-go`);
      expect(response?.status()).toBe(200);

      await expect(page.locator("h1").first()).toContainText("Why Go");
      await expect(page.locator("article")).toContainText(
        "dashes in its filename",
      );
    });
  });

  test.describe("#2491 — Graph shows single node for non-latin titles", () => {
    test("graph displays connections on page with cyrillic title", async ({
      page,
    }) => {
      await page.goto(`${BASE}/тест`);
      await page.waitForTimeout(3000);

      const graphInfo = await page.evaluate(() => {
        const container = document.querySelector(".graph-container");
        if (!container)
          return { exists: false, hasCanvas: false, nodeData: null };
        const canvas = container.querySelector("canvas");
        const cfg = container.getAttribute("data-cfg");
        return {
          exists: true,
          hasCanvas: !!canvas,
          containerChildren: container.children.length,
          cfg: cfg?.slice(0, 100),
        };
      });

      expect(graphInfo.exists).toBe(true);
      expect(graphInfo.hasCanvas).toBe(true);
    });
  });

  test.describe("#2372 — Graph text color doesn't change on theme toggle", () => {
    test("graph text color updates after dark mode toggle", async ({
      page,
    }) => {
      await page.goto(`${BASE}/`);
      await page.waitForTimeout(1000);

      const getGraphTextColor = async () => {
        return page.evaluate(() => {
          const text = document.querySelector(
            ".graph-outer text, #graph-container text",
          );
          if (!text) return null;
          return (
            window.getComputedStyle(text).fill ||
            window.getComputedStyle(text).color
          );
        });
      };

      const lightColor = await getGraphTextColor();

      const darkToggle = page.locator(".darkmode");
      if ((await darkToggle.count()) > 0) {
        await darkToggle.click();
        await page.waitForTimeout(500);
        const darkColor = await getGraphTextColor();

        if (lightColor && darkColor) {
          expect(darkColor).not.toBe(lightColor);
        }
      }
    });
  });

  test.describe("#2490 — Mermaid diagrams don't render after SPA navigation", () => {
    test("mermaid diagram renders after SPA navigation to the page", async ({
      page,
    }) => {
      await page.goto(`${BASE}/`);

      await page
        .locator('a[href*="mermaid-test"]')
        .and(page.locator(":visible"))
        .first()
        .click();
      await page.waitForURL(`**${BASE}/features/mermaid-test`);
      await page.waitForTimeout(2000);

      const hasMermaidOutput = await page.evaluate(() => {
        const mermaidSvg = document.querySelector(
          ".mermaid svg, pre.mermaid svg, [data-mermaid] svg",
        );
        const mermaidContainer = document.querySelector(
          ".mermaid, pre.mermaid, [data-mermaid]",
        );
        return {
          hasSvg: !!mermaidSvg,
          hasContainer: !!mermaidContainer,
          containerContent: mermaidContainer?.innerHTML?.slice(0, 200) || "",
        };
      });

      expect(hasMermaidOutput.hasContainer).toBe(true);
      expect(hasMermaidOutput.hasSvg).toBe(true);
    });

    test("mermaid diagram renders on direct page load", async ({ page }) => {
      await page.goto(`${BASE}/features/mermaid-test`);
      await page.waitForTimeout(2000);

      const hasMermaidSvg = await page.evaluate(() => {
        return !!document.querySelector(
          ".mermaid svg, pre.mermaid svg, [data-mermaid] svg",
        );
      });

      expect(hasMermaidSvg).toBe(true);
    });
  });

  test.describe("#2434 — Created date wrong without frontmatter", () => {
    test("page without frontmatter loads and has content", async ({ page }) => {
      const response = await page.goto(`${BASE}/no-frontmatter`);
      expect(response?.status()).toBe(200);

      await expect(page.locator("article")).toContainText(
        "no YAML frontmatter",
      );
    });
  });

  test.describe("#2452 — SVG images stretch out of container", () => {
    test("images are constrained to article width", async ({ page }) => {
      await page.goto(`${BASE}/features/callouts`);

      const images = page.locator("article img, article svg");
      const count = await images.count();

      for (let i = 0; i < count; i++) {
        const imgBox = await images.nth(i).boundingBox();
        const articleBox = await page.locator("article").boundingBox();

        if (imgBox && articleBox) {
          expect(imgBox.width).toBeLessThanOrEqual(articleBox.width + 1);
        }
      }
    });
  });

  test.describe("#2468 — Tags with mixed case not found in bases filters", () => {
    test("base with mixed-case tag filter finds matching notes", async ({
      page,
    }) => {
      const response = await page.goto(`${BASE}/tag-filter.base`);
      expect(response?.status()).toBe(200);

      const hasNoData = await page.locator("text=No data found").count();
      expect(hasNoData).toBe(0);

      const rows = await page
        .locator(".bases-table tbody tr, .bases-body tr")
        .count();
      expect(rows).toBeGreaterThan(0);
    });

    test("base with lowercase tag filter finds matching notes (control)", async ({
      page,
    }) => {
      await page.goto(`${BASE}/tag-filter-lower.base`);

      const hasNoData = await page.locator("text=No data found").count();
      expect(hasNoData).toBe(0);

      const rows = await page
        .locator(".bases-table tbody tr, .bases-body tr")
        .count();
      expect(rows).toBeGreaterThan(0);
    });
  });

  test.describe("#2456 — Bases date formula MMM renders wrong", () => {
    test("date format MMM renders month name not number", async ({ page }) => {
      await page.goto(`${BASE}/date-format.base`);

      const cells = await page.locator("td").allTextContents();
      const monthValues = cells.filter(
        (c) => c.trim().length > 0 && c.trim().length <= 10,
      );

      const hasMonthName = monthValues.some((v) =>
        /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(v.trim()),
      );
      const hasBadFormat = monthValues.some((v) => /^0\d{2}$/.test(v.trim()));

      expect(hasBadFormat).toBe(false);
      expect(hasMonthName).toBe(true);
    });
  });

  test.describe("#2463 — recent-notes list cut off, no scroll", () => {
    test("recent-notes list is scrollable in a short viewport", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1200, height: 400 });
      await page.goto(`${BASE}/`);
      await page.waitForTimeout(1000);

      const recentNotes = page.locator(".recent-notes");
      if ((await recentNotes.count()) === 0) {
        test.skip();
        return;
      }

      const overflow = await recentNotes.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const parent = el.closest(".sidebar") || el.parentElement;
        const parentStyle = parent ? window.getComputedStyle(parent) : null;
        return {
          ownOverflowY: style.overflowY,
          parentOverflowY: parentStyle?.overflowY || "N/A",
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          isClipped: el.scrollHeight > el.clientHeight,
        };
      });

      if (overflow.isClipped) {
        const hasScroll =
          overflow.ownOverflowY === "auto" ||
          overflow.ownOverflowY === "scroll" ||
          overflow.parentOverflowY === "auto" ||
          overflow.parentOverflowY === "scroll";
        expect(hasScroll).toBe(true);
      }
    });
  });

  test.describe("crawl-links#4 — Anchor links not normalized for non-ASCII headings", () => {
    test("anchor link to CJK heading resolves to a valid target", async ({
      page,
    }) => {
      await page.goto(`${BASE}/features/anchor-links`);

      const anchorLink = page
        .locator('a[href*="#"]')
        .filter({ hasText: "Jump to CJK heading" });
      if ((await anchorLink.count()) === 0) {
        test.skip();
        return;
      }

      const href = await anchorLink.getAttribute("href");
      expect(href).toBeTruthy();

      const headingId = href!.split("#")[1]!;
      const target = await page.evaluate((id) => {
        const byId = document.getElementById(id);
        const byDecoded = document.getElementById(decodeURIComponent(id));
        return !!(byId || byDecoded);
      }, headingId);

      expect(target).toBe(true);
    });
  });

  test.describe("crawl-links#1 — prettyLinks truncates aliases with slash", () => {
    test("wikilink alias containing slash is preserved", async ({ page }) => {
      await page.goto(`${BASE}/features/pretty-links`);

      const slashLink = page
        .locator("a.internal")
        .filter({ hasText: /Part 1/ });
      expect(await slashLink.count()).toBeGreaterThan(0);

      const text = await slashLink.first().textContent();
      expect(text?.trim()).toBe("Part 1/Part 2");
    });
  });

  test.describe("graph#2 — Graph fails with encoded chars in URL", () => {
    test("graph renders on page with curly braces in title", async ({
      page,
    }) => {
      await page.goto(`${BASE}/{curly-title}`);
      await page.waitForTimeout(3000);

      const graphInfo = await page.evaluate(() => {
        const container = document.querySelector(".graph-container");
        return {
          exists: !!container,
          hasCanvas: !!container?.querySelector("canvas"),
        };
      });

      expect(graphInfo.exists).toBe(true);
      expect(graphInfo.hasCanvas).toBe(true);
    });
  });

  test.describe("OFM#2 — SVG wikilinks not resolved", () => {
    test("embedded SVG via wikilink renders as image", async ({ page }) => {
      await page.goto(`${BASE}/features/svg-embed`);

      const svgEmbed = await page.evaluate(() => {
        const img = document.querySelector('img[src*="star"]');
        const svg = document.querySelector("article svg");
        const embed = document.querySelector(
          '[src*="star.svg"], [data-src*="star.svg"]',
        );
        return {
          hasImg: !!img,
          hasSvg: !!svg,
          hasEmbed: !!embed,
          imgSrc: img?.getAttribute("src") || null,
        };
      });

      const rendered = svgEmbed.hasImg || svgEmbed.hasSvg || svgEmbed.hasEmbed;
      expect(rendered).toBe(true);
    });
  });

  test.describe("bases-page#1 — View name with spaces breaks transclusion", () => {
    test("transclusion of base view with spaces in name resolves the view", async ({
      page,
    }) => {
      await page.goto(`${BASE}/features/base-transclusion`);

      const result = await page.evaluate(() => {
        const article = document.querySelector("article")?.textContent || "";
        return {
          hasViewNotFound: /View\s+"[^"]+"\s+not found/.test(article),
          hasBasesInline: !!document.querySelector(
            ".bases-inline, .bases-page",
          ),
        };
      });

      expect(result.hasViewNotFound).toBe(false);
      expect(result.hasBasesInline).toBe(true);
    });
  });

  test.describe("#2428 — Code font ligatures fuse CLI flags", () => {
    test("code blocks have ligatures disabled", async ({ page }) => {
      await page.goto(`${BASE}/docs/getting-started`);

      const codeBlock = page.locator("pre code").first();
      if ((await codeBlock.count()) === 0) {
        test.skip();
        return;
      }

      const fontVariantLigatures = await codeBlock.evaluate((el) => {
        return window.getComputedStyle(el).fontVariantLigatures;
      });

      expect(fontVariantLigatures).toMatch(/none|no-common-ligatures/);
    });
  });
});
