/// <reference lib="dom" />
/**
 * Shared page-probing helpers for `inspect` and `visual`.
 *
 * - Pure helpers (viewports, page path normalization, style key generation,
 *   page discovery) are unit-tested in tests/inspect*.test.ts / visual*.test.ts.
 * - `collect*` functions run *inside* the browser via page.evaluate. They must
 *   be self-contained (no closures over module scope).
 * - `openDeterministicPage` sets up a Playwright context that renders the same
 *   pixels every time: fixed viewport, reduced motion, frozen Date/Math.random,
 *   no animations/transitions/caret, explicit light/dark theme.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Viewports & themes
// ---------------------------------------------------------------------------

export interface Viewport {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
}

/** Quartz breakpoints: mobile < 800px <= tablet < 1200px <= desktop. */
export const VIEWPORTS: Record<string, Viewport> = {
  desktop: { name: "desktop", width: 1440, height: 900, isMobile: false },
  tablet: { name: "tablet", width: 1000, height: 900, isMobile: false },
  mobile: { name: "mobile", width: 390, height: 844, isMobile: true },
};

export function parseViewport(spec: string): Viewport {
  const named = VIEWPORTS[spec];
  if (named) return named;
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(spec);
  if (!match) {
    throw new Error(
      `Invalid viewport "${spec}" (use ${Object.keys(VIEWPORTS).join("|")} or WxH)`,
    );
  }
  const width = Number(match[1]);
  return { name: spec, width, height: Number(match[2]), isMobile: width < 800 };
}

export type Theme = "light" | "dark";

export function parseTheme(spec: string): Theme {
  if (spec === "light" || spec === "dark") return spec;
  throw new Error(`Invalid theme "${spec}" (use light|dark)`);
}

/** Split a comma list flag ("a,b" or ["a","b"]) into trimmed non-empty items. */
export function splitList(
  value: string | boolean | undefined,
  fallback: string[] = [],
): string[] {
  if (typeof value !== "string") return fallback;
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

// ---------------------------------------------------------------------------
// Page paths
// ---------------------------------------------------------------------------

/**
 * Normalize a user-supplied page to a slug: "/docs/foo.html" -> "docs/foo",
 * "" | "/" -> "index", "docs/" -> "docs/index".
 */
export function normalizePage(page: string): string {
  let p = page.trim().replace(/^https?:\/\/[^/]+/, "");
  p = p.split("#")[0].split("?")[0];
  p = p.replace(/^\/+/, "");
  if (p === "" || p === "index" || p === "index.html") return "index";
  if (p.endsWith("/")) return `${p}index`;
  return p.replace(/\.html$/, "");
}

/** URL path (relative to the base path) for a slug: "docs/index" -> "docs/". */
export function pageUrlPath(slug: string): string {
  if (slug === "index") return "/";
  if (slug.endsWith("/index")) return `/${slug.slice(0, -"index".length)}`;
  return `/${slug}`;
}

/** Filesystem-safe name for a slug: "docs/getting-started" -> "docs__getting-started". */
export function pageFileName(slug: string): string {
  return (
    slug
      .replace(/\//g, "__")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .slice(0, 120) || "page"
  );
}

export interface DiscoveredPage {
  slug: string;
  kind: "index" | "content" | "folder" | "tag" | "other";
  size: number;
}

function walkHtml(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "static") continue;
      walkHtml(root, full, out);
    } else if (entry.name.endsWith(".html")) {
      out.push(relative(root, full).split(sep).join("/"));
    }
  }
  return out;
}

/** Classify a built HTML file (relative path) into a discovered page. */
export function classifyPage(
  relPath: string,
  html: string,
): DiscoveredPage | undefined {
  if (relPath === "404.html") return undefined;
  if (/http-equiv=["']?refresh/i.test(html.slice(0, 2000))) return undefined; // alias redirect
  const slug = relPath.replace(/\.html$/, "");
  let kind: DiscoveredPage["kind"] = "content";
  if (slug === "index") kind = "index";
  else if (slug === "tags/index" || slug.startsWith("tags/")) kind = "tag";
  else if (slug.endsWith("/index")) kind = "folder";
  return { slug, kind, size: html.length };
}

/** All pages of a built site, sorted by slug. */
export function discoverPages(siteDir: string): DiscoveredPage[] {
  if (!existsSync(siteDir) || !statSync(siteDir).isDirectory()) return [];
  const pages: DiscoveredPage[] = [];
  for (const file of walkHtml(siteDir)) {
    const page = classifyPage(file, readFileSync(join(siteDir, file), "utf-8"));
    if (page) pages.push(page);
  }
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * A small representative set: index, the 3 largest content pages, the largest
 * folder page and one tag page (a specific tag preferred over tags/index).
 */
export function pickDefaultPages(pages: DiscoveredPage[]): string[] {
  const bySizeDesc = (a: DiscoveredPage, b: DiscoveredPage) =>
    b.size - a.size || a.slug.localeCompare(b.slug);
  const picked: string[] = [];
  if (pages.some((p) => p.kind === "index")) picked.push("index");
  picked.push(
    ...pages
      .filter((p) => p.kind === "content")
      .sort(bySizeDesc)
      .slice(0, 3)
      .map((p) => p.slug),
  );
  const folder = pages.filter((p) => p.kind === "folder").sort(bySizeDesc)[0];
  if (folder) picked.push(folder.slug);
  const tags = pages.filter((p) => p.kind === "tag");
  const tag = tags.find((p) => p.slug !== "tags/index") ?? tags[0];
  if (tag) picked.push(tag.slug);
  return picked;
}

// ---------------------------------------------------------------------------
// Computed styles
// ---------------------------------------------------------------------------

/** Curated computed-style properties, in report order. */
export const STYLE_PROPS = [
  "display",
  "position",
  "top",
  "left",
  "width",
  "height",
  "margin",
  "padding",
  "box-sizing",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration-line",
  "text-transform",
  "white-space",
  "color",
  "background-color",
  "background-image",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "box-shadow",
  "outline",
  "overflow-x",
  "overflow-y",
  "z-index",
  "grid-template-columns",
  "grid-template-rows",
  "grid-template-areas",
  "gap",
  "flex-direction",
  "flex-wrap",
  "flex",
  "justify-content",
  "align-items",
  "order",
  "transform",
  "visibility",
  "opacity",
  "cursor",
] as const;

/**
 * Values considered "default" for snapshot compaction: a prop equal to its
 * default is omitted from styles/*.json and treated as this value when diffing.
 */
export const STYLE_DEFAULTS: Record<string, string> = {
  position: "static",
  top: "auto",
  left: "auto",
  margin: "0px",
  padding: "0px",
  "box-sizing": "content-box",
  "font-style": "normal",
  "letter-spacing": "normal",
  "text-align": "start",
  "text-decoration-line": "none",
  "text-transform": "none",
  "white-space": "normal",
  "background-color": "rgba(0, 0, 0, 0)",
  "background-image": "none",
  "border-radius": "0px",
  "box-shadow": "none",
  "overflow-x": "visible",
  "overflow-y": "visible",
  "z-index": "auto",
  "grid-template-columns": "none",
  "grid-template-rows": "none",
  "grid-template-areas": "none",
  gap: "normal",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  flex: "0 1 auto",
  "justify-content": "normal",
  "align-items": "normal",
  order: "0",
  transform: "none",
  visibility: "visible",
  opacity: "1",
  cursor: "auto",
};

/** Props skipped in snapshots (the bounding box already captures them). */
export const SNAPSHOT_SKIP_PROPS = new Set(["width", "height", "top", "left"]);

/** Drop props equal to their default; collapse uniform borders into `border`. */
export function compactStyles(
  styles: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const sides = ["border-top", "border-right", "border-bottom", "border-left"];
  const uniform = sides.every((s) => styles[s] === styles["border-top"]);
  for (const [prop, value] of Object.entries(styles)) {
    if (value === undefined || value === "") continue;
    if (sides.includes(prop) && uniform) continue;
    if (prop === "border" && !uniform) continue;
    if (STYLE_DEFAULTS[prop] === value) continue;
    // Borders/outlines with style "none" don't render; drop them for brevity.
    if (
      (prop === "border" || prop === "outline" || sides.includes(prop)) &&
      /\bnone\b/.test(value)
    )
      continue;
    out[prop] = value;
  }
  return out;
}

/** Inverse of compactStyles for one prop (used when diffing). */
export function styleValue(
  styles: Record<string, string>,
  prop: string,
): string {
  return styles[prop] ?? STYLE_DEFAULTS[prop] ?? "(none)";
}

// ---------------------------------------------------------------------------
// Stable element keys
// ---------------------------------------------------------------------------

/** Raw node as collected in the browser by collectSnapshotNodes. */
export interface RawNode {
  parent: number;
  tag: string;
  id: string;
  classes: string[];
  /** Layout slot name if this element *is* a slot (key restarts here). */
  slot?: string;
  box: [number, number, number, number];
  visible: boolean;
  text?: string;
  styles: Record<string, string>;
}

/**
 * Ids that look generated (counters like "explorer-16" / "list-0", hashes,
 * long numbers) are not stable keys; nth-of-type disambiguates instead.
 */
export function isStableId(id: string): boolean {
  return (
    !!id &&
    id.length <= 48 &&
    !/\d{5,}|[0-9a-f]{10,}|:r\d|^\d|^[a-z]+[-_:]?\d+$/i.test(id)
  );
}

/** Classes that are runtime state or generated, excluded from keys. */
export function isStableClass(cls: string): boolean {
  return (
    !/^(svelte|css|jsx|sc)-[a-z0-9]+$/i.test(cls) && !/[0-9a-f]{8,}/i.test(cls)
  );
}

/** One key segment: tag#id.classA.classB:nth(2) (classes sorted). */
export function keySegment(
  node: Pick<RawNode, "tag" | "id" | "classes">,
  nth?: number,
): string {
  let seg = node.tag;
  if (isStableId(node.id)) seg += `#${node.id}`;
  const classes = node.classes.filter(isStableClass).sort();
  if (classes.length) seg += `.${classes.join(".")}`;
  if (nth !== undefined) seg += `:nth(${nth})`;
  return seg;
}

/**
 * Build stable keys for collected nodes. Keys restart at layout slots
 * ("[left] div.explorer > ul.explorer-ul") so wrappers above a slot don't
 * matter; elements outside slots are keyed from <body>. Duplicates get "~2".
 */
export function buildKeys(nodes: RawNode[]): string[] {
  // Disambiguate siblings by their *key* signature (stable id + stable
  // classes), not the raw DOM signature: two <h2> whose ids are dropped as
  // unstable must still get :nth(1)/:nth(2). Children are collected in DOM
  // order, so the order within a parent is the sibling order.
  const base = nodes.map((n) => keySegment(n));
  const nth: number[] = [];
  const counts = new Map<string, number>();
  nodes.forEach((n, i) => {
    const sig = `${n.parent}\u0000${base[i]}`;
    const c = (counts.get(sig) ?? 0) + 1;
    counts.set(sig, c);
    nth[i] = c;
  });
  const keys: string[] = [];
  const seen = new Map<string, number>();
  nodes.forEach((node, i) => {
    const total = counts.get(`${node.parent}\u0000${base[i]}`) ?? 1;
    const seg = total > 1 ? `${base[i]}:nth(${nth[i]})` : base[i];
    let key: string;
    if (node.slot) key = `[${node.slot}]`;
    else if (node.parent < 0) key = seg;
    else key = `${keys[node.parent]} > ${seg}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    keys[i] = count > 1 ? `${key}~${count}` : key;
  });
  return keys;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** Fixed clock for captures: 2024-01-01T12:00:00Z. */
export const FROZEN_TIME = Date.UTC(2024, 0, 1, 12, 0, 0);

export const DETERMINISTIC_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

/** Init script source: tsx/esbuild `__name` shim + theme preference (+ frozen time). */
export function initScript(theme: Theme, freeze: boolean): string {
  const lines = [
    // esbuild keepNames wraps functions in __name(); make it exist in the page.
    "globalThis.__name = globalThis.__name || ((f) => f);",
    `try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}`,
    `document.documentElement && document.documentElement.setAttribute("saved-theme", ${JSON.stringify(theme)});`,
  ];
  if (freeze) {
    lines.push(`(() => {
  const T = ${FROZEN_TIME};
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(T); else super(...args); }
    static now() { return T; }
  }
  globalThis.Date = FrozenDate;
  let seed = 42;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
})();`);
  }
  return lines.join("\n");
}

export interface OpenPageOptions {
  viewport: Viewport;
  theme: Theme;
  /** Visual-regression mode: frozen clock/random, no animations. */
  deterministic: boolean;
  /** configuration.baseUrl, routed to `localBase` (see routeSiteOrigin). */
  siteBaseUrl?: unknown;
  localBase?: string;
}

/**
 * Map a site's absolute public URL (configuration.baseUrl, e.g.
 * "localhost/bug-repro") to the local static server. Quartz emits absolute
 * URLs for some assets (fonts, og images); without this they hit the network.
 * Returns the URL prefixes being rewritten.
 */
export function siteOriginPrefixes(baseUrl: unknown): string[] {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return [];
  const host = baseUrl
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "");
  return [`https://${host}/`, `http://${host}/`];
}

/** Rewrite a public site URL to the local server, or undefined if not ours. */
export function rewriteSiteUrl(
  url: string,
  prefixes: string[],
  localBase: string,
): string | undefined {
  for (const prefix of prefixes) {
    if (url.startsWith(prefix))
      return `${localBase.replace(/\/+$/, "")}/${url.slice(prefix.length)}`;
  }
  return undefined;
}

export async function routeSiteOrigin(
  context: BrowserContext,
  baseUrl: unknown,
  localBase: string,
): Promise<void> {
  const prefixes = siteOriginPrefixes(baseUrl);
  if (!prefixes.length) return;
  await context.route(
    (url) => rewriteSiteUrl(url.href, prefixes, localBase) !== undefined,
    async (route) => {
      const target = rewriteSiteUrl(
        route.request().url(),
        prefixes,
        localBase,
      )!;
      try {
        const response = await route.fetch({ url: target });
        await route.fulfill({ response });
      } catch {
        await route.abort();
      }
    },
  );
}

/** Chromium-internal console noise that is never a site bug. */
export function isConsoleNoise(text: string): boolean {
  return /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL/i.test(
    text,
  );
}

/**
 * Chromium flags that make rasterization reproducible: software rendering,
 * no LCD subpixel text, fixed color profile, no font hinting variance.
 */
export const DETERMINISTIC_LAUNCH_ARGS = [
  "--disable-gpu",
  "--disable-lcd-text",
  "--font-render-hinting=none",
  "--force-color-profile=srgb",
  "--disable-partial-raster",
  "--disable-skia-runtime-opts",
  "--hide-scrollbars",
  "--disable-font-subpixel-positioning",
];

export async function newProbeContext(
  browser: Browser,
  opts: OpenPageOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: opts.viewport.width, height: opts.viewport.height },
    deviceScaleFactor: 1,
    isMobile: opts.viewport.isMobile,
    hasTouch: opts.viewport.isMobile,
    colorScheme: opts.theme,
    reducedMotion: opts.deterministic ? "reduce" : "no-preference",
    locale: "en-US",
    timezoneId: "UTC",
  });
  await context.addInitScript(initScript(opts.theme, opts.deterministic));
  if (opts.localBase)
    await routeSiteOrigin(context, opts.siteBaseUrl, opts.localBase);
  return context;
}

/** Navigate and wait until the page is visually settled. */
export async function gotoSettled(
  page: Page,
  url: string,
  opts: { theme: Theme; deterministic: boolean; timeoutMs?: number },
): Promise<number | undefined> {
  const timeout = opts.timeoutMs ?? 30_000;
  const response = await page.goto(url, { waitUntil: "load", timeout });
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  if (opts.deterministic)
    await page.addStyleTag({ content: DETERMINISTIC_CSS });
  await page.evaluate((theme) => {
    document.documentElement.setAttribute("saved-theme", theme);
  }, opts.theme);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (opts.deterministic) {
    // Blur focused elements and let two frames pass so layout settles.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          (document.activeElement as HTMLElement | null)?.blur?.();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  }
  return response?.status();
}

// ---------------------------------------------------------------------------
// In-browser collectors (self-contained; executed via page.evaluate)
// ---------------------------------------------------------------------------

/** Layout slot name -> selector. Order matters (first match wins for keys). */
export const LAYOUT_SLOTS: [string, string][] = [
  ["header", ".page > header, #quartz-body > header"],
  ["left", ".left.sidebar"],
  ["page-header", ".center > .page-header"],
  ["article", ".center > article"],
  ["page-footer", ".center > .page-footer"],
  ["right", ".right.sidebar"],
  ["footer", "#quartz-body > footer, .page > footer, body > footer"],
];

export interface BoxInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutChild {
  /** "plugin/Component" from Quartz's data-quartz-plugin attribution, if present. */
  source?: string;
  tag: string;
  classes: string;
  id: string;
  box: BoxInfo;
  visible: boolean;
  reason?: string;
}

export interface LayoutSlot {
  slot: string;
  selector: string;
  found: boolean;
  box?: BoxInfo;
  visible?: boolean;
  children: LayoutChild[];
}

export interface OverflowInfo {
  scrollWidth: number;
  clientWidth: number;
  overflowing: boolean;
  offenders: { selector: string; right: number; width: number }[];
}

export interface SelectorReport {
  selector: string;
  count: number;
  boxes: (BoxInfo & { visible: boolean })[];
  styles?: Record<string, string>;
  html?: string[];
  error?: string;
}

/** Runs in the browser: layout map + horizontal overflow. */
export function collectLayout(slots: [string, string][]): {
  layout: LayoutSlot[];
  overflow: OverflowInfo;
  title: string;
  slug: string;
} {
  const r = (n: number) => Math.round(n * 10) / 10;
  const boxOf = (el: Element): BoxInfo => {
    const b = el.getBoundingClientRect();
    return {
      x: r(b.left + window.scrollX),
      y: r(b.top + window.scrollY),
      width: r(b.width),
      height: r(b.height),
    };
  };
  const visibility = (el: Element): { visible: boolean; reason?: string } => {
    const cs = getComputedStyle(el);
    if (cs.display === "none")
      return { visible: false, reason: "display:none" };
    if (cs.visibility === "hidden")
      return { visible: false, reason: "visibility:hidden" };
    if (Number(cs.opacity) === 0)
      return { visible: false, reason: "opacity:0" };
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0)
      return { visible: false, reason: "zero size" };
    if (
      (el as HTMLElement).offsetParent === null &&
      cs.position !== "fixed" &&
      el.tagName !== "BODY"
    ) {
      return { visible: false, reason: "hidden ancestor" };
    }
    return { visible: true };
  };
  const layout: LayoutSlot[] = slots.map(([slot, selector]) => {
    const el = document.querySelector(selector);
    if (!el) return { slot, selector, found: false, children: [] };
    const v = visibility(el);
    return {
      slot,
      selector,
      found: true,
      box: boxOf(el),
      visible: v.visible,
      children: Array.from(el.children)
        .filter(
          (c) =>
            !["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE"].includes(
              c.tagName,
            ),
        )
        .map((c) => {
          const cv = visibility(c);
          // Quartz annotates plugin component roots with data-quartz-plugin /
          // data-quartz-component (core components/attribution.ts).
          const attributed = c.matches("[data-quartz-plugin]")
            ? c
            : c.querySelector("[data-quartz-plugin]");
          const plugin = attributed?.getAttribute("data-quartz-plugin");
          const component = attributed?.getAttribute("data-quartz-component");
          return {
            source: plugin ? `${plugin}/${component ?? "?"}` : undefined,
            tag: c.tagName.toLowerCase(),
            classes: Array.from(c.classList).join("."),
            id: c.id,
            box: boxOf(c),
            visible: cv.visible,
            reason: cv.reason,
          };
        }),
    };
  });
  const de = document.documentElement;
  const vw = de.clientWidth;
  const offenders: OverflowInfo["offenders"] = [];
  if (de.scrollWidth > vw + 1) {
    const all = Array.from(document.body.querySelectorAll("*"));
    for (const el of all) {
      const b = el.getBoundingClientRect();
      if (b.right <= vw + 1 || b.width === 0) continue;
      const parent = el.parentElement;
      if (
        parent &&
        parent !== document.body &&
        parent.getBoundingClientRect().right > vw + 1
      )
        continue;
      // Skip elements inside a horizontally scrollable container (that's fine).
      let scroller = false;
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        const ox = getComputedStyle(p).overflowX;
        if (
          ox === "auto" ||
          ox === "scroll" ||
          ox === "hidden" ||
          ox === "clip"
        ) {
          scroller = true;
          break;
        }
      }
      if (scroller) continue;
      const cls = Array.from(el.classList).slice(0, 3).join(".");
      offenders.push({
        selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`,
        right: r(b.right),
        width: r(b.width),
      });
      if (offenders.length >= 10) break;
    }
  }
  return {
    layout,
    overflow: {
      scrollWidth: de.scrollWidth,
      clientWidth: vw,
      overflowing: de.scrollWidth > vw + 1,
      offenders,
    },
    title: document.title,
    slug: document.body.dataset.slug ?? "",
  };
}

/** Runs in the browser: per-selector boxes, computed styles, outerHTML. */
export function collectSelectors(args: {
  selectors: string[];
  htmlSelectors: string[];
  props: string[];
  maxBoxes: number;
  maxHtml: number;
}): SelectorReport[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  const out: SelectorReport[] = [];
  const all = [...new Set([...args.selectors, ...args.htmlSelectors])];
  for (const selector of all) {
    let els: Element[];
    try {
      els = Array.from(document.querySelectorAll(selector));
    } catch (error) {
      out.push({ selector, count: 0, boxes: [], error: String(error) });
      continue;
    }
    const report: SelectorReport = { selector, count: els.length, boxes: [] };
    for (const el of els.slice(0, args.maxBoxes)) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      report.boxes.push({
        // Fixed elements are viewport-relative; don't add the page scroll.
        x: r(b.left + (cs.position === "fixed" ? 0 : window.scrollX)),
        y: r(b.top + (cs.position === "fixed" ? 0 : window.scrollY)),
        width: r(b.width),
        height: r(b.height),
        visible:
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          b.width > 0 &&
          b.height > 0,
      });
    }
    if (els[0] && args.selectors.includes(selector)) {
      const cs = getComputedStyle(els[0]);
      const styles: Record<string, string> = {};
      for (const prop of args.props) styles[prop] = cs.getPropertyValue(prop);
      report.styles = styles;
    }
    if (args.htmlSelectors.includes(selector)) {
      report.html = els.slice(0, 3).map((el) => {
        const html = el.outerHTML.replace(/\s+/g, " ");
        return html.length > args.maxHtml
          ? `${html.slice(0, args.maxHtml)}… [${html.length} chars]`
          : html;
      });
    }
    out.push(report);
  }
  return out;
}

/**
 * Runs in the browser: walk the DOM breadth-first from <body> and collect
 * bounded raw nodes for the style snapshot, plus root custom properties.
 */
export function collectSnapshotNodes(args: {
  slots: [string, string][];
  props: string[];
  maxNodes: number;
  maxDepth: number;
}): {
  nodes: RawNode[];
  truncated: boolean;
  rootVars: Record<string, string>;
  docHeight: number;
} {
  const r = (n: number) => Math.round(n);
  const SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "NOSCRIPT",
    "TEMPLATE",
    "BR",
    "WBR",
  ]);
  const slotOf = new Map<Element, string>();
  for (const [slot, selector] of args.slots) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!slotOf.has(el)) slotOf.set(el, slot);
    }
  }
  const nodes: RawNode[] = [];
  // sx/sy: accumulated scroll offsets of scrollable ancestors, so boxes are in
  // content coordinates and an inner scroll position does not look like a move.
  const queue: {
    el: Element;
    parent: number;
    depth: number;
    sx: number;
    sy: number;
  }[] = [{ el: document.body, parent: -1, depth: 0, sx: 0, sy: 0 }];
  let truncated = false;
  while (queue.length) {
    const { el, parent, depth, sx, sy } = queue.shift()!;
    if (nodes.length >= args.maxNodes) {
      truncated = true;
      break;
    }
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const styles: Record<string, string> = {};
    for (const prop of args.props) styles[prop] = cs.getPropertyValue(prop);
    const tag = el.tagName.toLowerCase();
    let text: string | undefined;
    if (/^h[1-6]$/.test(tag) || tag === "a" || tag === "button") {
      text =
        (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60) ||
        undefined;
    }
    const index = nodes.length;
    nodes.push({
      parent,
      tag,
      id: el.id,
      classes: Array.from(el.classList),
      slot: slotOf.get(el),
      box: [
        r(b.left + window.scrollX + sx),
        r(b.top + window.scrollY + sy),
        r(b.width),
        r(b.height),
      ],
      visible:
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        b.width > 0 &&
        b.height > 0,
      text,
      styles,
    });
    // Don't descend into hidden subtrees or SVG internals.
    if (cs.display === "none" || tag === "svg" || depth >= args.maxDepth)
      continue;
    for (const child of Array.from(el.children)) {
      if (SKIP.has(child.tagName)) continue;
      queue.push({
        el: child,
        parent: index,
        depth: depth + 1,
        sx: el === document.body ? sx : sx + el.scrollLeft,
        sy: el === document.body ? sy : sy + el.scrollTop,
      });
    }
  }
  // Custom properties declared anywhere in same-origin stylesheets, read on :root.
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      if (style) {
        for (let i = 0; i < style.length; i += 1) {
          if (style[i].startsWith("--")) names.add(style[i]);
        }
      }
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) visit(nested);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // cross-origin stylesheet
    }
  }
  const rootStyle = getComputedStyle(document.documentElement);
  const rootVars: Record<string, string> = {};
  for (const name of [...names].sort()) {
    const value = rootStyle.getPropertyValue(name).trim();
    if (value) rootVars[name] = value;
  }
  return {
    nodes,
    truncated,
    rootVars,
    docHeight: document.documentElement.scrollHeight,
  };
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export interface CliSpec {
  /** Flags that never take a value (`--json`, `--no-build`). */
  booleans: string[];
  /** Flags that may repeat (`--selector a --selector b`). */
  repeatable?: string[];
}

export interface ParsedCli {
  positional: string[];
  flags: Record<string, string | boolean>;
  lists: Record<string, string[]>;
}

/**
 * Like lib/args parseArgs, but boolean flags never swallow the next
 * positional (`--screenshot index` keeps "index" as a page) and repeatable
 * flags accumulate.
 */
export function parseCli(argv: string[], spec: CliSpec): ParsedCli {
  const booleans = new Set(spec.booleans);
  const repeatable = new Set(spec.repeatable ?? []);
  const out: ParsedCli = { positional: [], flags: {}, lists: {} };
  for (const name of repeatable) out.lists[name] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      out.positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      out.positional.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const eq = raw.indexOf("=");
    const name = eq === -1 ? raw : raw.slice(0, eq);
    let value: string | boolean;
    if (eq !== -1) value = raw.slice(eq + 1);
    else if (booleans.has(name)) value = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    } else value = true;
    if (repeatable.has(name) && typeof value === "string")
      out.lists[name].push(value);
    else out.flags[name] = value;
  }
  return out;
}

export function flagString(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}
