/// <reference lib="dom" />
/**
 * Pixel comparison of two PNGs inside headless Chromium (no pngjs/pixelmatch
 * dependency): both images are decoded into canvases, compared per pixel, and
 * a diff PNG is produced (changed pixels red over a faded grayscale base).
 */
import type { Page } from "@playwright/test";
import { regionsFromTiles, type PixelResult } from "./visual-diff.js";

export const REGION_TILE = 16;

interface BrowserDiff {
  changed: number;
  width: number;
  height: number;
  baseSize: [number, number];
  headSize: [number, number];
  tiles: number[];
  cols: number;
  rows: number;
  diff: string;
}

/** Runs in the browser. */
async function browserDiff(args: {
  base: string;
  head: string;
  tolerance: number;
  tile: number;
}): Promise<BrowserDiff> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = src;
    });
  const [a, b] = await Promise.all([load(args.base), load(args.head)]);
  const width = Math.max(a.naturalWidth, b.naturalWidth);
  const height = Math.max(a.naturalHeight, b.naturalHeight);
  const pixels = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const pa = pixels(a);
  const pb = pixels(b);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const octx = out.getContext("2d")!;
  const od = octx.createImageData(width, height);
  const cols = Math.ceil(width / args.tile);
  const rows = Math.ceil(height / args.tile);
  const tiles = new Array<number>(cols * rows).fill(0);
  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const inA = x < a.naturalWidth && y < a.naturalHeight;
      const inB = x < b.naturalWidth && y < b.naturalHeight;
      const d = Math.max(
        Math.abs(pa[i] - pb[i]),
        Math.abs(pa[i + 1] - pb[i + 1]),
        Math.abs(pa[i + 2] - pb[i + 2]),
        Math.abs(pa[i + 3] - pb[i + 3]),
      );
      if (inA !== inB || d > args.tolerance) {
        changed += 1;
        tiles[Math.floor(y / args.tile) * cols + Math.floor(x / args.tile)] = 1;
        od.data[i] = 230;
        od.data[i + 1] = 20;
        od.data[i + 2] = 60;
        od.data[i + 3] = 255;
      } else {
        const g = 0.299 * pa[i] + 0.587 * pa[i + 1] + 0.114 * pa[i + 2];
        const v = 255 - (255 - g) * 0.25;
        od.data[i] = v;
        od.data[i + 1] = v;
        od.data[i + 2] = v;
        od.data[i + 3] = 255;
      }
    }
  }
  octx.putImageData(od, 0, 0);
  return {
    changed,
    width,
    height,
    baseSize: [a.naturalWidth, a.naturalHeight],
    headSize: [b.naturalWidth, b.naturalHeight],
    tiles,
    cols,
    rows,
    diff: changed ? out.toDataURL("image/png") : "",
  };
}

export interface PngDiff {
  result: PixelResult;
  diffPng?: Buffer;
}

/**
 * Compare two PNG buffers. `page` should be a blank page from any context;
 * it is reused between calls. `tolerance` is the max per-channel delta
 * treated as equal (0 = exact).
 */
export async function diffPngs(
  page: Page,
  shot: string,
  base: Buffer,
  head: Buffer,
  tolerance = 0,
): Promise<PngDiff> {
  if (base.equals(head)) {
    const w = base.readUInt32BE(16);
    const h = base.readUInt32BE(20);
    return {
      result: {
        shot,
        changedPixels: 0,
        totalPixels: w * h,
        ratio: 0,
        baseSize: [w, h],
        headSize: [w, h],
        regions: [],
      },
    };
  }
  await page.evaluate("globalThis.__name = globalThis.__name || ((f) => f)");
  const r = await page.evaluate(browserDiff, {
    base: `data:image/png;base64,${base.toString("base64")}`,
    head: `data:image/png;base64,${head.toString("base64")}`,
    tolerance,
    tile: REGION_TILE,
  });
  const total = r.width * r.height;
  return {
    result: {
      shot,
      changedPixels: r.changed,
      totalPixels: total,
      ratio: total ? r.changed / total : 0,
      baseSize: r.baseSize,
      headSize: r.headSize,
      regions: regionsFromTiles(r.tiles, r.cols, r.rows, REGION_TILE, {
        width: r.width,
        height: r.height,
      }),
    },
    diffPng: r.diff
      ? Buffer.from(r.diff.slice(r.diff.indexOf(",") + 1), "base64")
      : undefined,
  };
}
