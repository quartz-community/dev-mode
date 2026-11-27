import type { Page } from "@playwright/test";
import { test, expect } from "../../helpers/repro-fixture";
import { blockExternalNetwork } from "../../helpers/offline";

// The comments plugin (giscus) at runtime: comments.inline.ts appends giscus' client.js to the
// `.giscus` container with the configured options as data attributes, once per page, re-creates
// it for the page an SPA navigation shows, and forwards theme changes to the giscus iframe.
//
// giscus.app is answered locally: client.js is a stub that records its own attributes and adds
// an `iframe.giscus-frame` (as the real one does); the iframe's page echoes every message it
// gets back to the parent, so the spec can see what the plugin posts to it.

const CLIENT = "https://giscus.app/client.js";

const STUB_CLIENT = `(() => {
  const script = document.currentScript;
  const attrs = {};
  for (const a of script.attributes) attrs[a.name] = a.value;
  (window.__giscus = window.__giscus || []).push({ attrs, path: location.pathname });
  const frame = document.createElement("iframe");
  frame.className = "giscus-frame";
  frame.src = "https://giscus.app/widget?term=" + encodeURIComponent(location.pathname);
  script.insertAdjacentElement("afterend", frame);
})();`;

const STUB_WIDGET = `<!doctype html><script>
  addEventListener("message", (e) => parent.postMessage({ echo: e.data }, "*"));
</script>`;

type Load = { attrs: Record<string, string>; path: string };

async function setup(page: Page, site: { baseUrl: string }) {
  await blockExternalNetwork(page, site);
  const giscus = { clientRequests: 0 };
  await page.route("https://giscus.app/**", async (route) => {
    const url = route.request().url();
    if (url === CLIENT) {
      giscus.clientRequests++;
      await route.fulfill({
        contentType: "application/javascript",
        body: STUB_CLIENT,
      });
    } else if (url.startsWith("https://giscus.app/widget")) {
      await route.fulfill({ contentType: "text/html", body: STUB_WIDGET });
    } else {
      await route.fulfill({ status: 200, body: "" });
    }
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __echo: unknown[] };
    w.__echo = [];
    addEventListener("message", (e) => {
      if (e.origin === "https://giscus.app") w.__echo.push(e.data);
    });
  });
  return giscus;
}

const loads = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __giscus?: Load[] }).__giscus ?? [],
  );

/** The `.giscus` container holds exactly one client.js script and one iframe. */
async function expectOneWidget(page: Page) {
  const container = page.locator(".giscus");
  await expect(container).toHaveCount(1);
  await expect(container.locator(`script[src="${CLIENT}"]`)).toHaveCount(1);
  await expect(container.locator("iframe.giscus-frame")).toHaveCount(1);
}

async function spaClick(page: Page, text: string, url: RegExp) {
  await page.locator("article a.internal", { hasText: text }).first().click();
  await page.waitForURL(url);
  await expect(page).toHaveTitle(new RegExp(`^${text}\\b`));
}

test.describe("comments: giscus client script", () => {
  test("loads client.js once with the configured attributes", async ({
    page,
    site,
    pageProblems,
  }) => {
    const giscus = await setup(page, site);
    await page.goto(site.url("Alpha"));
    await expectOneWidget(page);

    const script = page.locator(`.giscus script[src="${CLIENT}"]`);
    const theme = await page.locator("html").getAttribute("saved-theme");
    expect(theme).toMatch(/^(light|dark)$/);
    const attrs = await script.evaluate((s: HTMLScriptElement) => ({
      async: s.async,
      crossOrigin: s.crossOrigin,
      data: Object.fromEntries(
        [...s.attributes]
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => [a.name, a.value]),
      ),
    }));
    expect(attrs).toEqual({
      async: true,
      crossOrigin: "anonymous",
      data: {
        "data-loading": "lazy",
        "data-emit-metadata": "0",
        "data-repo": "example/repo",
        "data-repo-id": "R_dummy",
        "data-category": "Announcements",
        "data-category-id": "DIC_dummy",
        "data-mapping": "pathname",
        "data-strict": "0",
        "data-reactions-enabled": "0",
        "data-input-position": "top",
        "data-lang": "nl",
        "data-theme":
          theme === "dark"
            ? "https://giscus.app/themes/dark_dimmed.css"
            : "https://giscus.app/themes/light_protanopia.css",
      },
    });
    // the script ran (and saw the same attributes)
    expect(await loads(page)).toEqual([
      { attrs: expect.objectContaining(attrs.data), path: "/alpha" },
    ]);

    // another `render` on the same page (encrypted-pages dispatches one) adds nothing
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent("render")),
    );
    await page.waitForTimeout(300);
    await expectOneWidget(page);
    expect(giscus.clientRequests).toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });

  test("an SPA navigation re-creates giscus for the new page", async ({
    page,
    site,
    pageProblems,
  }) => {
    const giscus = await setup(page, site);
    await page.goto(site.url("Alpha"));
    await expectOneWidget(page);
    await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));

    await spaClick(page, "Beta", /\/beta$/);
    await expectOneWidget(page);
    await expect(page.locator(".giscus iframe.giscus-frame")).toHaveAttribute(
      "src",
      /term=%2Fbeta$/,
    );
    expect((await loads(page)).map((l) => l.path)).toEqual(["/alpha", "/beta"]);
    expect(giscus.clientRequests).toBe(2);

    // `comments: false` in the frontmatter: no container, nothing loaded
    await spaClick(page, "Alpha", /\/alpha$/);
    await spaClick(page, "Quiet", /\/quiet$/);
    await expect(page.locator(".giscus")).toHaveCount(0);
    await expect(page.locator("iframe.giscus-frame")).toHaveCount(0);
    expect((await loads(page)).map((l) => l.path)).toEqual([
      "/alpha",
      "/beta",
      "/alpha",
    ]);

    await spaClick(page, "Alpha", /\/alpha$/);
    await expectOneWidget(page);
    expect(giscus.clientRequests).toBe(4);
    // all of it without a page load
    expect(
      await page.evaluate(() => (window as unknown as { __m?: number }).__m),
    ).toBe(1);
    expect(pageProblems.all()).toEqual([]);
  });

  test("a theme change is posted to the giscus iframe", async ({
    page,
    site,
    pageProblems,
  }) => {
    await setup(page, site);
    await page.goto(site.url("Alpha"));
    await expectOneWidget(page);
    // wait until the stub widget page listens
    await expect
      .poll(() =>
        page
          .frameLocator(".giscus iframe.giscus-frame")
          .locator("script")
          .count(),
      )
      .toBe(1);

    const html = page.locator("html");
    const before = await html.getAttribute("saved-theme");
    await page.locator(".darkmode").first().click();
    const after = before === "dark" ? "light" : "dark";
    await expect(html).toHaveAttribute("saved-theme", after);
    const expected = {
      echo: {
        giscus: {
          setConfig: {
            theme:
              after === "dark"
                ? "https://giscus.app/themes/dark_dimmed.css"
                : "https://giscus.app/themes/light_protanopia.css",
          },
        },
      },
    };
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __echo: unknown[] }).__echo,
        ),
      )
      .toEqual([expected]);

    // after an SPA navigation, one click posts one message (to the new iframe)
    await spaClick(page, "Beta", /\/beta$/);
    await expectOneWidget(page);
    await expect
      .poll(() =>
        page
          .frameLocator(".giscus iframe.giscus-frame")
          .locator("script")
          .count(),
      )
      .toBe(1);
    await page.locator(".darkmode").first().click();
    await expect(html).toHaveAttribute("saved-theme", before!);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __echo: unknown[] }).__echo.length,
        ),
      )
      .toBe(2);
    await page.waitForTimeout(300);
    const echo = await page.evaluate(
      () => (window as unknown as { __echo: unknown[] }).__echo,
    );
    expect(echo).toHaveLength(2);
    expect(pageProblems.all()).toEqual([]);
  });
});
