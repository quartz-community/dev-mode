/**
 * Serve absolute production URLs from the local build.
 *
 * Quartz emits some absolute URLs built from `configuration.baseUrl`
 * (e.g. self-hosted font files `https://<baseUrl>/static/fonts/...`, og
 * images, canonical links). Locally those hit the real internet (or nothing,
 * for `localhost/...` base URLs) and show up as failed requests that mask
 * real problems. This routes any request to the configured baseUrl host to the
 * built site directory, so local runs behave like production.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  MIME_TYPES,
  normalizeBasePath,
  resolveSiteFile,
} from "./static-server.js";

export function baseUrlHost(
  baseUrl: unknown,
): { host: string; basePath: string } | null {
  if (typeof baseUrl !== "string" || !baseUrl) return null;
  const withoutProto = baseUrl.replace(/^[a-z]+:\/\//i, "");
  const slash = withoutProto.indexOf("/");
  const host = slash === -1 ? withoutProto : withoutProto.slice(0, slash);
  const basePath =
    slash === -1 ? "" : normalizeBasePath(withoutProto.slice(slash));
  return host ? { host, basePath } : null;
}

/** Map a production URL to a site-relative path, or null if it isn't one. */
export function productionUrlToSitePath(
  url: string,
  host: string,
  basePath: string,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.host !== host) return null;
  let path = decodeURIComponent(parsed.pathname);
  if (basePath) {
    if (!(path === basePath || path.startsWith(`${basePath}/`))) return null;
    path = path.slice(basePath.length);
  }
  return path || "/";
}

/**
 * Install the route on a context or page. Returns the number of requests
 * served so callers can report it.
 */
export async function routeProductionUrls(
  target: BrowserContext | Page,
  options: { baseUrl: unknown; siteDir: string },
): Promise<{ served: () => number }> {
  const info = baseUrlHost(options.baseUrl);
  let served = 0;
  if (!info) return { served: () => served };
  const escaped = info.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await target.route(new RegExp(`^https?://${escaped}(/|$)`), async (route) => {
    const path = productionUrlToSitePath(
      route.request().url(),
      info.host,
      info.basePath,
    );
    const file = path ? resolveSiteFile(options.siteDir, path) : null;
    if (!file) {
      await route.fulfill({
        status: 404,
        body: "Not found (dev-mode production-URL route)",
      });
      return;
    }
    served += 1;
    await route.fulfill({
      status: 200,
      contentType:
        MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      body: readFileSync(file),
    });
  });
  return { served: () => served };
}
