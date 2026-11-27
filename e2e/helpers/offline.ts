/**
 * Keep a repro off the internet: every request that does not go to the repro's own server
 * (Google Fonts, giscus.app, jsDelivr, map tile servers, …) is answered locally with an empty
 * 200 response, so a test neither needs the network nor reports blocked requests as problems.
 *
 *   const external = await blockExternalNetwork(page, site);
 *   await page.route("https://giscus.app/client.js", (r) => r.fulfill({ body: "…" })); // wins
 *   expect(external.requests).toContain("https://fonts.googleapis.com/…");
 *
 * Register specific `page.route` handlers after this one: Playwright tries routes in reverse
 * order of registration.
 */
import type { Page, Route } from "@playwright/test";

const contentTypes: [RegExp, string][] = [
  [/\.css(\?|$)/, "text/css"],
  [/\.m?js(\?|$)/, "application/javascript"],
  [/\.json(\?|$)/, "application/json"],
  [/\.(png|jpe?g|gif|webp)(\?|$)/, "image/png"],
];

export interface ExternalRequests {
  /** URLs of the external requests that were answered locally, in order. */
  requests: string[];
}

export async function blockExternalNetwork(
  page: Page,
  site: { baseUrl: string },
): Promise<ExternalRequests> {
  const origin = new URL(site.baseUrl).origin;
  const seen: ExternalRequests = { requests: [] };
  await page.route(
    (url) => url.origin !== origin && /^(https?|wss?):$/.test(url.protocol),
    async (route: Route) => {
      const url = route.request().url();
      seen.requests.push(url);
      const type =
        contentTypes.find(([re]) => re.test(url))?.[1] ?? "text/plain";
      await route.fulfill({ status: 200, contentType: type, body: "" });
    },
  );
  return seen;
}
