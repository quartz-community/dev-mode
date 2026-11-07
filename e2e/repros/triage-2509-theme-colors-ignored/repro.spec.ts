import { test, expect } from "../../helpers/repro-fixture";

// #2509: with @quartz-themes/core enabled (obsidian/ttrpg templates enable it),
// configuration.theme.colors has no effect on text colour, and per-element
// overrides of Quartz colour variables (e.g. `.somnihil { --darkgray: … }` in
// custom.scss) are ignored too.

test.describe("Repro for jackyzha0/quartz#2509", () => {
  for (const mode of ["light", "dark"] as const) {
    test(`${mode === "light" ? "control: " : ""}configured darkgray colours body text (${mode})`, async ({
      page,
      site,
    }) => {
      await page.emulateMedia({ colorScheme: mode });
      await page.goto(site.url("/"));
      const c = await page
        .locator("article p")
        .first()
        .evaluate((p) => getComputedStyle(p).color);
      expect(c).toBe("rgb(255, 0, 0)");
    });
  }

  test("element-scoped --darkgray override colours its text (dark)", async ({
    page,
    site,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(site.url("/"));
    const c = await page
      .locator(".scoped p")
      .evaluate((p) => getComputedStyle(p).color);
    expect(c).toBe("rgb(0, 255, 0)");
  });
});
