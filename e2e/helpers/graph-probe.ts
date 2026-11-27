/**
 * Look inside the graph plugin's PixiJS canvas from a Playwright test.
 *
 * The graph draws nodes and labels into a canvas, so there is no DOM to query. `installGraphProbe`
 * (an init script) wraps `PIXI.Application.prototype.init` as soon as the CDN build assigns
 * `window.PIXI`, and keeps every application the graph creates in `window.__graphProbe.apps`.
 * The helpers below read that scene graph: the graph's stage is
 * `app.stage.children[0]` with children `[links, activeLinks, nodes, labels]`; each node is a
 * `PIXI.Graphics` whose `label` is the node's slug, each label a `PIXI.Text`.
 */
import type { Page } from "@playwright/test";

export async function installGraphProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & {
      __graphProbe: { apps: unknown[] };
    };
    w.__graphProbe = { apps: [] };
    let pixi: unknown;
    Object.defineProperty(window, "PIXI", {
      configurable: true,
      get: () => pixi,
      set(value) {
        pixi = value;
        const app = (
          value as {
            Application?: {
              prototype: {
                init: (...a: unknown[]) => Promise<void>;
                __probed?: boolean;
              };
            };
          }
        )?.Application;
        if (!app || app.prototype.__probed) return;
        const init = app.prototype.init;
        app.prototype.init = function (this: unknown, ...args: unknown[]) {
          w.__graphProbe.apps.push(this);
          return init.apply(this, args);
        };
        app.prototype.__probed = true;
      },
    });
  });
}

export interface GraphNode {
  id: string;
  /** Centre of the node in page (CSS) coordinates. */
  x: number;
  y: number;
}

/**
 * Nodes of the live graph drawn in `canvasSelector`, with page coordinates. Only applications
 * whose canvas is still attached to the document count (a re-render destroys the old one).
 */
export function graphNodes(
  page: Page,
  canvasSelector = ".graph-container canvas",
): Promise<GraphNode[]> {
  return page.evaluate((sel) => {
    type Obj = {
      label?: string;
      children: Obj[];
      getGlobalPosition(): { x: number; y: number };
    };
    type App = { canvas: HTMLCanvasElement; stage: Obj };
    const apps = (window as unknown as { __graphProbe: { apps: App[] } })
      .__graphProbe.apps;
    const canvas = document.querySelector(sel);
    const app = apps.find((a) => {
      try {
        return a.canvas === canvas && a.canvas.isConnected;
      } catch {
        return false; // destroyed (its renderer is gone)
      }
    });
    if (!app) return [];
    const rect = app.canvas.getBoundingClientRect();
    const nodes = app.stage.children[0]?.children[2]?.children ?? [];
    return nodes.map((g) => {
      const p = g.getGlobalPosition();
      return { id: String(g.label), x: rect.left + p.x, y: rect.top + p.y };
    });
  }, canvasSelector);
}

/** Fill colours of the labels created so far in the live graph in `canvasSelector`. */
export function graphLabelFills(
  page: Page,
  canvasSelector = ".graph-container canvas",
): Promise<string[]> {
  return page.evaluate((sel) => {
    type Obj = { children: Obj[]; style?: { fill: unknown } };
    type App = { canvas: HTMLCanvasElement; stage: Obj };
    const apps = (window as unknown as { __graphProbe: { apps: App[] } })
      .__graphProbe.apps;
    const canvas = document.querySelector(sel);
    const app = apps.find((a) => {
      try {
        return a.canvas === canvas && a.canvas.isConnected;
      } catch {
        return false; // destroyed (its renderer is gone)
      }
    });
    if (!app) return [];
    const labels = app.stage.children[0]?.children[3]?.children ?? [];
    return labels.map((t) => {
      const fill = t.style?.fill as unknown;
      // PixiJS 8 keeps a FillStyle object ({ color: number }) or the raw value.
      if (fill && typeof fill === "object" && "color" in fill)
        return String((fill as { color: unknown }).color);
      return String(fill);
    });
  }, canvasSelector);
}
