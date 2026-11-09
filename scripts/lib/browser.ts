/**
 * Locate a Chromium binary that actually launches.
 *
 * On NixOS the Playwright-downloaded browsers lack system libraries, and a
 * stale `CHROME_BIN` from a cached direnv/flake shell can point at a Chromium
 * whose closure no longer matches the running glibc. Instead of failing every
 * test with an opaque launch error, probe candidates with `--version` and use
 * the first one that runs.
 *
 * Override with PLAYWRIGHT_CHROMIUM=<path> (always wins, not probed) or
 * PLAYWRIGHT_CHROMIUM=bundled to force Playwright's own download.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";

export interface BrowserResolution {
  executablePath: string | undefined;
  source: string;
  tried: { path: string; ok: boolean; detail: string }[];
}

let cached: BrowserResolution | undefined;

function probe(path: string): { ok: boolean; detail: string } {
  try {
    const out = execFileSync(path, ["--headless", "--version"], {
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    });
    return { ok: true, detail: out.trim() };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const detail = (err.stderr || err.message || "failed")
      .toString()
      .trim()
      .split("\n")[0];
    return { ok: false, detail };
  }
}

function which(cmd: string): string | undefined {
  try {
    return (
      execFileSync("sh", ["-c", `command -v ${cmd}`], {
        timeout: 5_000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export function resolveChromium(): BrowserResolution {
  if (cached) return cached;
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override === "bundled") {
    cached = {
      executablePath: undefined,
      source: "PLAYWRIGHT_CHROMIUM=bundled",
      tried: [],
    };
    return cached;
  }
  if (override) {
    cached = {
      executablePath: override,
      source: "PLAYWRIGHT_CHROMIUM",
      tried: [],
    };
    return cached;
  }

  let user = "";
  try {
    user = userInfo().username;
  } catch {
    // ignore
  }
  const candidates: [string, string | undefined][] = [
    ["CHROME_BIN", process.env.CHROME_BIN],
    [
      "user profile",
      user ? `/etc/profiles/per-user/${user}/bin/chromium` : undefined,
    ],
    [
      "nix profile",
      process.env.HOME
        ? `${process.env.HOME}/.nix-profile/bin/chromium`
        : undefined,
    ],
    ["system profile", "/run/current-system/sw/bin/chromium"],
    ["PATH chromium", which("chromium")],
    ["PATH chromium-browser", which("chromium-browser")],
    ["PATH google-chrome", which("google-chrome")],
  ];
  const tried: BrowserResolution["tried"] = [];
  const seen = new Set<string>();
  for (const [source, path] of candidates) {
    if (!path || seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    const result = probe(path);
    tried.push({ path, ...result });
    if (result.ok) {
      cached = { executablePath: path, source, tried };
      return cached;
    }
  }
  // Fall back to Playwright's bundled browser (works on most non-Nix systems).
  cached = { executablePath: undefined, source: "playwright bundled", tried };
  return cached;
}

/** Launch options fragment for Playwright. */
export function chromiumLaunchOptions(): { executablePath?: string } {
  const { executablePath } = resolveChromium();
  return executablePath ? { executablePath } : {};
}
