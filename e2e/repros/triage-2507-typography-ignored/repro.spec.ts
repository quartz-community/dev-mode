import { test, expect } from "../../helpers/repro-fixture";

// #2507: on a default install, changing configuration.theme.typography has no
// effect while @quartz-community/quartz-fonts is enabled (the default).
// Expected: the configured families are applied AND requested from Google Fonts.

test.describe("Repro for jackyzha0/quartz#2507", () => {
  test("configured typography is applied to headings and body", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const fam = await page.evaluate(() => ({
      h2: getComputedStyle(document.querySelector("article h2")!).fontFamily,
      p: getComputedStyle(document.querySelector("article p")!).fontFamily,
      code: getComputedStyle(document.querySelector("article code")!)
        .fontFamily,
    }));
    expect(fam.h2, JSON.stringify(fam)).toMatch(/^"?Lora/);
    expect(fam.p, JSON.stringify(fam)).toMatch(/^"?Lora/);
    expect(fam.code, JSON.stringify(fam)).toMatch(/^"?Fira Code/);
  });

  test("control: core requests the configured families from Google Fonts", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("/"));
    const hrefs = await page
      .locator('link[rel="stylesheet"][href*="fonts.googleapis.com"]')
      .evaluateAll((ls) => ls.map((l) => (l as HTMLLinkElement).href));
    const all = hrefs.join(" ");
    expect(all, all).toContain("family=Lora");
    expect(all, all).toMatch(/family=Fira(\+|%20)Code/);
  });
});
