import { test, expect } from "../../helpers/repro-fixture";
// search.inline.ts highlight(): the excerpt of a short text drops its last word and adds "...".

test("the excerpt of a short text is the whole text", async ({
  page,
  site,
}) => {
  await page.goto(site.url());
  await page.locator("button.search-button").first().click();
  await page.locator("input.search-bar").first().fill("alpha");
  const card = page
    .locator(".results-container .result-card:not(.no-match)")
    .first();
  await expect(card).toHaveAttribute("href", "/short");
  await expect(card.locator(".highlight")).toHaveText(["Alpha"]);
  await expect(card.locator(".card-description")).toHaveText(
    "Alpha beta gamma omega.",
  );
});
