import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_PATH = "/test-base";
const PORT = parseInt(process.env.PORT || "4173", 10);
const SITE_DIR = path.resolve(import.meta.dirname, "../.output/base-url-site");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

function resolveFile(urlPath: string): string | null {
  const candidates = [
    path.join(SITE_DIR, urlPath),
    path.join(SITE_DIR, urlPath + ".html"),
    path.join(SITE_DIR, urlPath, "index.html"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";

  if (!url.startsWith(BASE_PATH)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const stripped = url.slice(BASE_PATH.length) || "/";
  const filePath = resolveFile(stripped);

  if (!filePath) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Serving ${SITE_DIR} at http://localhost:${PORT}${BASE_PATH}/`);
});
