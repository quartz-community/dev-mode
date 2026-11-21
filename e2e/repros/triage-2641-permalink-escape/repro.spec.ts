import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { test, expect } from "../../helpers/repro-fixture";
// #2641: a permalink (core) or an alias (alias-redirects) with ".." segments was written outside
// the output folder. The sandbox builds into <sandbox>/public, so "../x" lands in <sandbox>/x.html.
test.describe("jackyzha0/quartz#2641 permalinks and aliases stay in the output folder", () => {
  const sandboxOf = (siteDir: string) =>
    resolve(siteDir, "../../sandboxes", basename(siteDir));

  test("a permalink with .. writes nothing outside the output folder", async ({
    site,
  }) => {
    const sandbox = sandboxOf(site.dir);
    expect(existsSync(sandbox)).toBe(true);
    expect(existsSync(join(sandbox, "escaped.html"))).toBe(false);
    expect(existsSync(join(sandbox, "escaped-og-image.webp"))).toBe(false);
  });

  test("an alias with .. writes nothing outside the output folder", async ({
    site,
  }) => {
    expect(existsSync(join(sandboxOf(site.dir), "aliasescaped.html"))).toBe(
      false,
    );
  });

  test("the note with the ignored permalink keeps its own path", async ({
    page,
    site,
  }) => {
    const html = await (await page.request.get(site.url("p"))).text();
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain("P body");
  });
});
