import { test, expect } from "../../helpers/repro-fixture";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
// #2556: tags/kubernetes.html sits next to a tags/kubernetes/ directory (children). Static hosts
// (GitHub Pages, nginx try_files $uri $uri/) resolve /tags/kubernetes[/] to the directory → 404.
// The local static server falls back to .html, so assert on the output layout.
test.describe("jackyzha0/quartz#2556 parent tag page reachable when it has child tags", () => {
  test("parent tag page does not collide with its child directory", async ({
    site,
  }) => {
    const dir = join(site.dir, "tags/kubernetes");
    const hasDir = existsSync(dir) && statSync(dir).isDirectory();
    const ok = !hasDir || existsSync(join(dir, "index.html"));
    expect(
      ok,
      "tags/kubernetes/ exists without index.html next to tags/kubernetes.html",
    ).toBe(true);
  });
  test("control: child tag page is served", async ({ page, site }) => {
    expect(
      (await page.request.get(site.url("tags/kubernetes/k3s"))).status(),
    ).toBe(200);
  });
});
