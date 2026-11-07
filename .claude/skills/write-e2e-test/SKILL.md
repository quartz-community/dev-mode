---
name: write-e2e-test
description: Write or extend browser end-to-end tests for rendered Quartz sites in this dev-mode workspace (Playwright, fixtures, repros, SPA navigation, base paths, mobile). Use when adding regression coverage, testing a feature across a built site, or when E2E tests fail and need diagnosing.
---

# End-to-end tests for Quartz sites

Two kinds of E2E tests exist. Pick one:

| | Repros `e2e/repros/<slug>/` | Fixture suites `e2e/tests/*.spec.ts` |
|---|---|---|
| Site | own content + config overlay, built on demand | shared `e2e/fixtures/<name>/`, prebuilt |
| Server | free port per worker, automatic | fixed ports 4173-4176 (`e2e/playwright.config.ts` webServer) |
| Use for | one bug / one feature, isolated | broad regression suites (navigation, base URL, search, mobile) |
| Run | `just repro-test [slug]` | `just e2e-build && just e2e-test [-- -g pattern]` |

Default to a **repro** (`just repro-new <slug>`, see `reproduce-bug` skill) unless the test belongs in an existing suite.
`just e2e` runs everything (builds fixtures in parallel, runs suites, then repros).

## Writing specs

Repro specs:
```ts
import { test, expect } from "../../helpers/repro-fixture";
test("explorer highlights current page", async ({ page, site, pageProblems }) => {
  await page.goto(site.url("docs/getting-started"));
  await expect(page.locator(".explorer .active")).toHaveText("Getting Started");
  expect(pageProblems.all()).toEqual([]);
});
```
Fixture specs use `test.use({ baseURL: "http://localhost:<port>" })` and prefix paths with the fixture's base path
(e.g. `/bug-repro/...`). New fixture → add dir in `e2e/fixtures/`, add a `webServer` entry with a free port
in `e2e/playwright.config.ts`; `build-fixture.ts all` picks it up automatically.

## Patterns that matter for Quartz

- **SPA navigation** (`enableSPA: true`): Quartz swaps page content and fires `nav` events. Test both a direct
  `page.goto` *and* navigation via clicking `a.internal` — many bugs only show on one. After clicking, wait with
  `await page.waitForURL(...)` and then assert on new content.
- **Base paths**: set `configuration.baseUrl: localhost/sub` in the overlay; `site.url()` handles the prefix.
  Assert link `href`s keep the prefix after SPA navigation.
- **Theme**: dark mode via `document.documentElement.setAttribute("saved-theme", "dark")` (check repos/darkmode).
- **Mobile**: `test.use({ viewport: { width: 375, height: 812 } })`; check horizontal overflow with
  `document.documentElement.scrollWidth <= window.innerWidth`.
- **Layout slots**: `.left.sidebar`, `.right.sidebar`, `.page-header`, `.center`, `article`, `footer`.
  Which plugin renders a class: `just catalog dom <class>`.
- Prefer role/text locators and stable classes over nth-child; avoid asserting build dates (mtime-based).
- Graph uses canvas — assert on presence/size or the data attributes, not pixels.

## Diagnosing failures

- Browser launch errors on NixOS: `just which-browser` (auto-probes CHROME_BIN, profile and system Chromium;
  override with `PLAYWRIGHT_CHROMIUM=/path` or `=bundled`).
- Failure artifacts: `.dev/test-results/{e2e,repros}/<test>/` — `error-context.md` has the page snapshot;
  open traces with `pnpm exec playwright show-trace <trace.zip>`.
- Look at the page yourself: `just inspect <target> <page> --screenshot` and Read the PNG.
- A fix "doesn't work"? Check for `⚠ dist/ is older than src/` in build output → `just build-plugin <name>`.
