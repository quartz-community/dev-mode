import { test, expect } from "../../helpers/repro-fixture";
// #2595 with diagramRenderer: pele (variant of triage-2595-mermaid-theme).
// #2595: @quartz-themes (theme: default, Obsidian template) sets Quartz colour vars to
// hsl(calc(...)); the OFM mermaid script passes the raw getPropertyValue() strings to mermaid,
// whose colour parser (khroma) throws "Unsupported color format". The theme plugin npm-installs
// into the sandbox, so we inject the same value the issue reports.
const VALUE = "hsl(calc(258 - 3), calc(88% * 1.02), calc(66% * 1.15))";
async function inject(page: import("@playwright/test").Page) {
  await page.addInitScript((v) => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = `:root, :root[saved-theme] { --secondary: ${v}; --tertiary: ${v}; }`;
      document.head.appendChild(s);
    });
  }, VALUE);
}
test.describe("jackyzha0/quartz#2595 (pele renderer) calc()-based theme colours", () => {
  test("control: renders with default colours", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await expect(page.locator("code.mermaid svg").first()).toBeVisible({
      timeout: 20000,
    });
    expect(pageProblems.all()).toEqual([]);
  });
  test("renders when vars use hsl(calc(...))", async ({
    page,
    site,
    pageProblems,
  }) => {
    await inject(page);
    await page.goto(site.url("/"));
    await page.waitForTimeout(4000);
    expect(pageProblems.all()).toEqual([]);
    await expect(page.locator("code.mermaid svg").first()).toBeVisible({
      timeout: 20000,
    });
    expect(pageProblems.all()).toEqual([]);
  });
  // Part 2 of the issue (TB flowchart with a subgraph drawn left-to-right) is upstream Mermaid
  // 11.4.0 behaviour: the same source rendered by bare mermaid.run() on a blank page also lays the
  // subgraph out horizontally (without the subgraph it is vertical). Not asserted here.
});
