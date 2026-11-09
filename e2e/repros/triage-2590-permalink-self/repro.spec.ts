import { test, expect } from "../../helpers/repro-fixture";
// #2590: permalink equal to the page's own slug → the alias redirect overwrites the page → infinite redirect.
test.describe("jackyzha0/quartz#2590 permalink equal to own path", () => {
  for (const [p, body] of [
    ["test-page", "Test page body"],
    ["other", "Other body"],
  ]) {
    test(`${p} shows its content`, async ({ page, site }) => {
      const res = await page.request.get(site.url(p));
      const html = await res.text();
      expect(html).not.toContain('http-equiv="refresh"');
      expect(html).toContain(body);
    });
  }
});
