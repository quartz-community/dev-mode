import { test, expect } from "../../helpers/repro-fixture";

// #2444: footer `message` option renders extra text (HTML allowed).

test("footer shows the configured message as HTML, between the Quartz line and the links", async ({
  page,
  site,
  pageProblems,
}) => {
  await page.goto(site.url("/"));
  const footer = page.locator("footer");
  const message = footer.locator("p.footer-message");
  await expect(message).toHaveText("Licensed under CC BY 4.0 · hello");
  await expect(message.locator('a[href="/license"]')).toHaveText("CC BY 4.0");
  await expect(message.locator("em")).toHaveText("hello");
  await expect(footer.locator("> *")).toHaveCount(3);
  await expect(footer.locator("> :nth-child(2)")).toHaveClass("footer-message");
  await expect(footer.locator("ul a").first()).toHaveText("GitHub");
  expect(pageProblems.all()).toEqual([]);
});
