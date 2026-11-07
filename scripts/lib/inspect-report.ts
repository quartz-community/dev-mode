/**
 * Text formatting for `inspect` (pure; unit-tested in tests/inspect.test.ts).
 */
import {
  compactStyles,
  type BoxInfo,
  type LayoutSlot,
  type OverflowInfo,
  type SelectorReport,
} from "./page-probe.js";

export interface PageInspection {
  page: string;
  url: string;
  viewport: string;
  theme: string;
  status?: number;
  title?: string;
  dataSlug?: string;
  clicked?: string;
  console: { type: string; text: string; location?: string }[];
  pageErrors: string[];
  failedRequests: { url: string; status: number; error?: string }[];
  layout: LayoutSlot[];
  overflow?: OverflowInfo;
  selectors: SelectorReport[];
  screenshot?: string;
  error?: string;
}

export interface InspectHeader {
  target: string;
  siteDir: string;
  basePath: string;
  buildMs?: number;
  warnings: string[];
}

const box = (b: BoxInfo) =>
  `${Math.round(b.width)}×${Math.round(b.height)} @ (${Math.round(b.x)},${Math.round(b.y)})`;

/** Strip origin so URLs stay short and stable. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(127\.0\.0\.1|localhost):\d+/, "");
}

/** Compact "prop: value; ..." with defaults omitted (width/height kept). */
export function formatStyles(styles: Record<string, string>): string {
  const compact = compactStyles(styles);
  return Object.entries(compact)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

export function formatPage(r: PageInspection): string[] {
  const out: string[] = [];
  out.push(
    `== ${r.page}  [${r.viewport}, ${r.theme}]  ${r.status ?? "?"}${r.title ? `  "${r.title}"` : ""}`,
  );
  out.push(
    `url: ${shortUrl(r.url)}${r.dataSlug !== undefined ? `  (body[data-slug="${r.dataSlug}"])` : ""}`,
  );
  if (r.error) out.push(`ERROR: ${r.error}`);
  if (r.clicked) out.push(`clicked: ${r.clicked}`);
  const errors = r.console.filter((c) => c.type === "error");
  const warns = r.console.filter((c) => c.type === "warning");
  out.push(`console: ${errors.length} errors, ${warns.length} warnings`);
  for (const c of r.console.slice(0, 15))
    out.push(
      `  ${c.type.padEnd(7)} ${c.text}${c.location ? `  (${shortUrl(c.location)})` : ""}`,
    );
  out.push(`page errors: ${r.pageErrors.length ? "" : "none"}`);
  for (const e of r.pageErrors.slice(0, 10)) out.push(`  ${e}`);
  out.push(
    `failed requests: ${r.failedRequests.length ? r.failedRequests.length : "none"}`,
  );
  for (const f of r.failedRequests.slice(0, 15)) {
    out.push(
      `  ${f.status || "ERR"} ${shortUrl(f.url)}${f.error ? ` (${f.error})` : ""}`,
    );
  }
  if (r.overflow) {
    if (r.overflow.overflowing) {
      out.push(
        `horizontal overflow: YES (scrollWidth ${r.overflow.scrollWidth} > viewport ${r.overflow.clientWidth})`,
      );
      for (const o of r.overflow.offenders)
        out.push(`  ${o.selector}  right=${o.right} width=${o.width}`);
    } else {
      out.push("horizontal overflow: none");
    }
  }
  if (r.layout.length) {
    out.push("layout:");
    for (const slot of r.layout) {
      if (!slot.found) {
        out.push(`  ${slot.slot.padEnd(12)} – not present (${slot.selector})`);
        continue;
      }
      out.push(
        `  ${slot.slot.padEnd(12)} ${slot.visible ? "visible" : "HIDDEN "} ${box(slot.box!)}  ${slot.children.length} children`,
      );
      for (const c of slot.children) {
        const name = `${c.tag}${c.id ? `#${c.id}` : ""}${c.classes ? `.${c.classes}` : ""}`;
        out.push(
          `    ${c.visible ? "✓" : "✗"} ${name.padEnd(40)} ${box(c.box)}${c.source ? `  ← ${c.source}` : ""}${c.visible ? "" : `  (${c.reason})`}`,
        );
      }
    }
  }
  for (const s of r.selectors) {
    if (s.error) {
      out.push(`selector ${s.selector}: INVALID (${s.error})`);
      continue;
    }
    out.push(
      `selector ${s.selector}: ${s.count} match${s.count === 1 ? "" : "es"}`,
    );
    s.boxes.forEach((b, i) =>
      out.push(`  [${i}] ${box(b)}${b.visible ? "" : "  (hidden)"}`),
    );
    if (s.count > s.boxes.length)
      out.push(`  … ${s.count - s.boxes.length} more`);
    if (s.styles)
      out.push(`  styles[0] (defaults omitted): ${formatStyles(s.styles)}`);
    for (const html of s.html ?? []) out.push(`  html: ${html}`);
  }
  if (r.screenshot) out.push(`screenshot: ${r.screenshot}`);
  return out;
}

export function formatInspectReport(
  header: InspectHeader,
  pages: PageInspection[],
): string {
  const lines: string[] = [];
  lines.push(
    `inspect ${header.target}  site=${header.siteDir}  base=${header.basePath || "/"}${header.buildMs !== undefined ? `  (built in ${(header.buildMs / 1000).toFixed(1)}s)` : "  (not rebuilt)"}`,
  );
  for (const w of header.warnings) lines.push(w);
  for (const page of pages) {
    lines.push("");
    lines.push(...formatPage(page));
  }
  return lines.join("\n");
}
