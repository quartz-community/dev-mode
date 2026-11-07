/**
 * Minimal static file server for built Quartz sites.
 *
 * Mirrors how Quartz sites are hosted (GitHub Pages style): clean URLs
 * (`/foo` -> `foo.html` or `foo/index.html`), an optional base path prefix, and
 * `404.html` served with a 404 status. Port 0 picks a free port, so many
 * servers can run in parallel (one per test worker / inspection).
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

export interface StaticServerOptions {
  /** Directory containing the built site. */
  root: string;
  /** URL prefix the site is served under, e.g. "/test-base". "" or "/" for none. */
  basePath?: string;
  /** 0 (default) picks a free port. */
  port?: number;
  host?: string;
}

export interface StaticServerHandle {
  server: Server;
  port: number;
  basePath: string;
  /** Origin + base path, without trailing slash. e.g. http://127.0.0.1:41234/test-base */
  baseUrl: string;
  /** Build a full URL for a site-relative path ("docs/index", "/", "tags/foo"). */
  url(pagePath?: string): string;
  close(): Promise<void>;
}

export function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  return `/${basePath.replace(/^\/+|\/+$/g, "")}`;
}

/** Resolve a decoded site-relative URL path to a file in root, or null. */
export function resolveSiteFile(root: string, urlPath: string): string | null {
  const cleaned = normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const base = join(root, cleaned);
  if (!base.startsWith(normalize(root + sep)) && base !== normalize(root))
    return null;
  const candidates = [base, `${base}.html`, join(base, "index.html")];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function startStaticServer(
  options: StaticServerOptions,
): Promise<StaticServerHandle> {
  const basePath = normalizeBasePath(options.basePath);
  const host = options.host ?? "127.0.0.1";
  const root = options.root;
  if (!existsSync(root)) {
    return Promise.reject(new Error(`Site directory not found: ${root}`));
  }

  const server = createServer((req, res) => {
    const rawUrl = req.url?.split("?")[0]?.split("#")[0] ?? "/";
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawUrl);
    } catch {
      decoded = rawUrl;
    }
    const send404 = () => {
      const notFound = join(root, "404.html");
      if (existsSync(notFound)) {
        res.writeHead(404, { "Content-Type": MIME_TYPES[".html"] });
        createReadStream(notFound).pipe(res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    };
    if (
      basePath &&
      !(decoded === basePath || decoded.startsWith(`${basePath}/`))
    ) {
      send404();
      return;
    }
    const stripped = decoded.slice(basePath.length) || "/";
    const file = resolveSiteFile(root, stripped);
    if (!file) {
      send404();
      return;
    }
    // Like GitHub Pages, Netlify and nginx: a directory without its trailing slash redirects,
    // so relative links on folder pages resolve as they do in production.
    if (
      file.endsWith(`${sep}index.html`) &&
      !stripped.endsWith("/") &&
      !stripped.endsWith("index.html") &&
      stripped !== "/"
    ) {
      const query = req.url?.includes("?")
        ? req.url.slice(req.url.indexOf("?"))
        : "";
      res.writeHead(301, { Location: `${rawUrl}/${query}` });
      res.end();
      return;
    }
    const contentType =
      MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port ?? 0, host, () => {
      const port = (server.address() as AddressInfo).port;
      const origin = `http://${host}:${port}`;
      const baseUrl = `${origin}${basePath}`;
      resolvePromise({
        server,
        port,
        basePath,
        baseUrl,
        url(pagePath = "/") {
          const p = pagePath.replace(/^\/+/, "");
          return `${baseUrl}/${p}`;
        },
        close() {
          return new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          });
        },
      });
    });
  });
}

/** Derive the base path from a Quartz `baseUrl` setting ("example.com/sub" -> "/sub"). */
export function basePathFromBaseUrl(baseUrl: unknown): string {
  if (typeof baseUrl !== "string" || !baseUrl) return "";
  const withoutProto = baseUrl.replace(/^[a-z]+:\/\//i, "");
  const slash = withoutProto.indexOf("/");
  return slash === -1 ? "" : normalizeBasePath(withoutProto.slice(slash));
}
