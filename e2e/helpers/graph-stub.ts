/**
 * Offline stand-ins for the graph plugin's d3 and PixiJS (loaded from jsDelivr by
 * graph.inline.ts), so graph specs need no network.
 *
 * The stand-ins accept any d3 / PixiJS call. `PIXI.Application` creates a real <canvas> (that is
 * what the graph puts into the page) and counts `init` / `destroy`; `d3.forceSimulation` records
 * how many nodes it was given. The scripts' `integrity` is dropped, as the stand-ins can't match
 * the pinned SRI hashes. This exercises the plugin's own code (loading, open / close, cleanup),
 * not d3's layout or PixiJS's drawing: `graph-probe.ts` / repro graph-runtime use the real ones.
 */
import type { Page } from "@playwright/test";

export const D3_URL = "https://cdn.jsdelivr.net/npm/d3@7.9.2/dist/d3.min.js";
export const PIXI_URL =
  "https://cdn.jsdelivr.net/npm/pixi.js@8.23.0/dist/pixi.min.js";

/** Accepts any property access, call, `new` and assignment; not a thenable. */
const CHAIN = `window.__chain = window.__chain || (() => {
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k === "then") return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      return p;
    },
    set: () => true,
    apply: () => p,
    construct: () => p,
  });
  return p;
});
window.__graphStub = window.__graphStub || { simulations: [], apps: 0, destroyed: 0 };`;

const D3_STUB = `${CHAIN}
window.d3 = new Proxy({}, {
  get(_, k) {
    if (k === "forceSimulation")
      return (nodes) => {
        window.__graphStub.simulations.push((nodes || []).length);
        return window.__chain();
      };
    if (k === "zoomIdentity") return { k: 1, x: 0, y: 0 };
    if (k === "min" || k === "max") return () => 0;
    return window.__chain();
  },
});`;

const PIXI_STUB = `${CHAIN}
class Application {
  async init(o) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = o.width;
    this.canvas.height = o.height;
    this.stage = window.__chain();
    this.ticker = window.__chain();
    this.renderer = window.__chain();
    window.__graphStub.apps++;
  }
  render() {}
  destroy() {
    this.canvas.remove();
    window.__graphStub.destroyed++;
  }
}
window.PIXI = new Proxy({ Application }, {
  get: (t, k) => (k in t ? t[k] : window.__chain()),
});`;

export interface GraphStub {
  /** Node count of every d3 simulation started, in order (local and global graphs). */
  simulations: number[];
  /** PixiJS applications initialised / destroyed. */
  apps: number;
  destroyed: number;
}

/** Serve the stand-ins; returns the list of library URLs requested. */
export async function stubGraphLibraries(page: Page): Promise<string[]> {
  const libs: string[] = [];
  await page.route(
    /^https:\/\/cdn\.jsdelivr\.net\/npm\/(d3|pixi\.js)@/,
    (route) => {
      const url = route.request().url();
      libs.push(url);
      return route.fulfill({
        contentType: "application/javascript",
        body: url === D3_URL ? D3_STUB : url === PIXI_URL ? PIXI_STUB : "",
      });
    },
  );
  await page.addInitScript(() => {
    Object.defineProperty(HTMLScriptElement.prototype, "integrity", {
      configurable: true,
      get: () => "",
      set: () => {},
    });
  });
  return libs;
}

export const graphStub = (page: Page): Promise<GraphStub | undefined> =>
  page.evaluate(
    () => (window as unknown as { __graphStub?: GraphStub }).__graphStub,
  );
