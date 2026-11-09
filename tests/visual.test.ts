import { describe, expect, it } from "vitest";
import {
  buildKeys,
  isStableId,
  keySegment,
  type RawNode,
} from "../scripts/lib/page-probe.js";
import {
  diffSnapshots,
  exceedsThreshold,
  groupSiblingMoves,
  groupStyleChanges,
  regionsFromTiles,
  renderMarkdownReport,
  shotId,
  summarizeCompare,
  toSnapshot,
  type PixelResult,
  type SnapElement,
  type StyleSnapshot,
} from "../scripts/lib/visual-diff.js";

function raw(
  partial: Partial<RawNode> & { parent: number; tag: string },
): RawNode {
  return {
    id: "",
    classes: [],
    box: [0, 0, 10, 10],
    visible: true,
    styles: {},
    ...partial,
  };
}

function snap(
  elements: SnapElement[],
  rootVars: Record<string, string> = {},
): StyleSnapshot {
  return {
    shot: "index@desktop-light",
    page: "index",
    viewport: "desktop",
    theme: "light",
    docHeight: 900,
    truncated: false,
    rootVars,
    elements,
  };
}

function el(
  key: string,
  parent: string | undefined,
  styles: Record<string, string> = {},
  box: [number, number, number, number] = [0, 0, 10, 10],
): SnapElement {
  return { key, parent, box, visible: true, styles };
}

describe("stable keys", () => {
  it("drops generated ids and hash classes", () => {
    expect(isStableId("explorer-16")).toBe(false);
    expect(isStableId("list-0")).toBe(false);
    expect(isStableId("a1b2c3d4e5f6a7")).toBe(false);
    expect(isStableId("quartz-root")).toBe(true);
    expect(isStableId("custom-callout-type-2450")).toBe(true);
    expect(
      keySegment({ tag: "div", id: "x", classes: ["b", "a", "css-1x2y3z"] }),
    ).toBe("div#x.a.b");
    expect(keySegment({ tag: "li", id: "", classes: [] }, 2)).toBe("li:nth(2)");
  });

  it("restarts at slots and disambiguates same-signature siblings", () => {
    const nodes: RawNode[] = [
      raw({ parent: -1, tag: "body" }),
      raw({
        parent: 0,
        tag: "div",
        classes: ["left", "sidebar"],
        slot: "left",
      }),
      raw({ parent: 1, tag: "h2", id: "step-1" }),
      raw({ parent: 1, tag: "h2", id: "step-2" }),
      raw({ parent: 1, tag: "h2", id: "intro-section" }),
      raw({ parent: 1, tag: "p" }),
      raw({ parent: 5, tag: "a", classes: ["internal"] }),
    ];
    expect(buildKeys(nodes)).toEqual([
      "body",
      "[left]",
      "[left] > h2:nth(1)",
      "[left] > h2:nth(2)",
      "[left] > h2#intro-section",
      "[left] > p",
      "[left] > p > a.internal",
    ]);
  });

  it("builds compact snapshots", () => {
    const s = toSnapshot(
      { shot: "x", page: "index", viewport: "desktop", theme: "light" },
      {
        nodes: [
          raw({
            parent: -1,
            tag: "body",
            styles: {
              display: "block",
              position: "static",
              color: "rgb(0, 0, 0)",
            },
          }),
        ],
        truncated: false,
        rootVars: { "--secondary": "#284b63" },
        docHeight: 100,
      },
    );
    expect(s.elements[0]).toEqual({
      key: "body",
      parent: undefined,
      box: [0, 0, 10, 10],
      visible: true,
      styles: { display: "block", color: "rgb(0, 0, 0)" },
    });
    expect(shotId("docs__a", "mobile", "dark")).toBe("docs__a@mobile-dark");
  });
});

describe("diffSnapshots", () => {
  it("reports nothing for identical snapshots", () => {
    const a = snap(
      [el("body", undefined, { color: "red" }), el("[left]", "body")],
      { "--x": "1" },
    );
    const d = diffSnapshots(a, structuredClone(a));
    expect(d.varChanges).toEqual([]);
    expect(d.styleChanges).toEqual([]);
    expect(d.moved).toEqual([]);
    expect(d.appeared).toEqual([]);
  });

  it("reports root vars and folds inherited style changes into the ancestor", () => {
    const base = snap(
      [
        el("[left]", undefined, { color: "rgb(0, 0, 0)" }),
        el("[left] > h2.page-title", "[left]", {
          color: "rgb(0, 0, 0)",
          "font-size": "28px",
        }),
        el("[left] > h2.page-title > a", "[left] > h2.page-title", {
          color: "rgb(0, 0, 0)",
        }),
      ],
      { "--dark": "#000" },
    );
    const head = snap(
      [
        el("[left]", undefined, { color: "rgb(255, 0, 0)" }),
        el("[left] > h2.page-title", "[left]", {
          color: "rgb(255, 0, 0)",
          "font-size": "32px",
        }),
        el("[left] > h2.page-title > a", "[left] > h2.page-title", {
          color: "rgb(255, 0, 0)",
        }),
      ],
      { "--dark": "#f00" },
    );
    const d = diffSnapshots(base, head);
    expect(d.varChanges).toEqual([
      { prop: "--dark", before: "#000", after: "#f00" },
    ]);
    // h2 has an extra (font-size) change, so it is its own entry; the <a> only
    // inherits the color change, which folds into... the h2 (same color change subset).
    expect(d.styleChanges.map((c) => c.key)).toEqual([
      "[left]",
      "[left] > h2.page-title",
    ]);
    expect(d.styleChanges[1].changes).toContainEqual({
      prop: "font-size",
      before: "28px",
      after: "32px",
    });
  });

  it("treats omitted props as defaults", () => {
    const d = diffSnapshots(
      snap([el("body", undefined, { opacity: "0.5" })]),
      snap([el("body", undefined, {})]),
    );
    expect(d.styleChanges[0].changes).toEqual([
      { prop: "opacity", before: "0.5", after: "1" },
    ]);
  });

  it("reports moves once per moved subtree and resizes separately", () => {
    const base = snap([
      el("body", undefined, {}, [0, 0, 1000, 1000]),
      el("[article]", "body", {}, [300, 100, 600, 400]),
      el("[article] > p", "[article]", {}, [300, 100, 600, 20]),
      el("[article] > p > a", "[article] > p", {}, [300, 100, 50, 20]),
    ]);
    const head = snap([
      el("body", undefined, {}, [0, 0, 1000, 1000]),
      el("[article]", "body", {}, [300, 120, 600, 400]),
      el("[article] > p", "[article]", {}, [300, 120, 600, 20]),
      el("[article] > p > a", "[article] > p", {}, [300, 120, 50, 20]),
    ]);
    const d = diffSnapshots(base, head);
    expect(d.moved).toEqual([
      {
        key: "[article]",
        before: [300, 100, 600, 400],
        after: [300, 120, 600, 400],
        followers: 2,
      },
    ]);
    expect(d.resized).toEqual([]);

    head.elements[1].box = [300, 100, 640, 400];
    head.elements[2].box = [300, 100, 600, 20];
    head.elements[3].box = [300, 100, 50, 20];
    const r = diffSnapshots(base, head);
    expect(r.resized.map((x) => x.key)).toEqual(["[article]"]);
    expect(r.moved).toEqual([]);
  });

  it("reports appeared/disappeared subtrees once", () => {
    const base = snap([
      el("body", undefined),
      el("[right]", "body"),
      el("[right] > div.toc", "[right]"),
      el("[right] > div.toc > ul", "[right] > div.toc"),
    ]);
    const head = snap([
      el("body", undefined),
      el("[right]", "body"),
      el("[right] > div.graph", "[right]"),
    ]);
    const d = diffSnapshots(base, head);
    expect(d.disappeared).toEqual(["[right] > div.toc"]);
    expect(d.appeared).toEqual(["[right] > div.graph"]);
  });

  it("groups sibling moves and identical style changes", () => {
    const parentOf = new Map<string, string | undefined>([
      ["ul > li:nth(1)", "ul"],
      ["ul > li:nth(2)", "ul"],
      ["ul > li:nth(3)", "ul"],
      ["x", undefined],
    ]);
    const mv = (key: string, dy: number) => ({
      key,
      before: [0, 0, 1, 1] as [number, number, number, number],
      after: [0, dy, 1, 1] as [number, number, number, number],
      followers: 1,
    });
    const grouped = groupSiblingMoves(
      [
        mv("ul > li:nth(1)", 6),
        mv("ul > li:nth(2)", 6),
        mv("ul > li:nth(3)", 6),
        mv("x", 6),
      ],
      parentOf,
    );
    expect(grouped.map((g) => g.key)).toEqual(["ul > *[3 siblings]", "x"]);
    expect(grouped[0].followers).toBe(3);

    const c = { prop: "color", before: "a", after: "b" };
    const groups = groupStyleChanges([
      { key: "k1", changes: [c], inherited: 1 },
      {
        key: "k2",
        changes: [{ prop: "margin", before: "0px", after: "4px" }],
        inherited: 0,
      },
      { key: "k3", changes: [c], inherited: 2 },
    ]);
    expect(groups[0]).toEqual({
      changes: [c],
      keys: ["k1", "k3"],
      inherited: 3,
    });
  });
});

describe("thresholds and regions", () => {
  const px = (
    shot: string,
    ratio: number,
    size: [number, number] = [100, 100],
    head: [number, number] = size,
  ): PixelResult => ({
    shot,
    changedPixels: Math.round(ratio * 10000),
    totalPixels: 10000,
    ratio,
    baseSize: size,
    headSize: head,
    regions: [],
  });

  it("fails above the threshold or on size changes", () => {
    expect(exceedsThreshold(px("a", 0.0005), 0.001)).toBe(false);
    expect(exceedsThreshold(px("a", 0.002), 0.001)).toBe(true);
    expect(exceedsThreshold(px("a", 0, [100, 100], [100, 120]), 0.001)).toBe(
      true,
    );
  });

  it("counts style changes unless pixels-only", () => {
    const d = diffSnapshots(
      snap([el("body", undefined, { color: "a" })]),
      snap([el("body", undefined, { color: "b" })]),
    );
    expect(
      summarizeCompare([px("a", 0)], [d], [], [], { threshold: 0.001 }).failed,
    ).toBe(true);
    expect(
      summarizeCompare([px("a", 0)], [d], [], [], {
        threshold: 0.001,
        pixelsOnly: true,
      }).failed,
    ).toBe(false);
    expect(
      summarizeCompare([px("a", 0)], [], ["gone"], [], { threshold: 0.001 })
        .failed,
    ).toBe(true);
  });

  it("groups changed tiles into regions", () => {
    // 4x3 grid: a 2x2 blob top-left, a single tile bottom-right.
    const mask = [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1];
    expect(regionsFromTiles(mask, 4, 3, 16, { width: 60, height: 48 })).toEqual(
      [
        { x: 0, y: 0, width: 32, height: 32 },
        { x: 48, y: 32, width: 12, height: 16 },
      ],
    );
  });

  it("renders a ranked markdown report with overview", () => {
    const base = snap(
      [el("[left] > h2.page-title", undefined, { "font-size": "28px" })],
      {
        "--secondary": "#284b63",
      },
    );
    const head = snap(
      [el("[left] > h2.page-title", undefined, { "font-size": "32px" })],
      {
        "--secondary": "#c2185b",
      },
    );
    const diffs = [diffSnapshots(base, head)];
    const pixels = [
      px("index@desktop-light", 0.05),
      px("other@mobile-dark", 0),
    ];
    const md = renderMarkdownReport({
      base: "base",
      head: "head",
      threshold: 0.001,
      pixels,
      diffs,
      summary: summarizeCompare(pixels, diffs, [], [], { threshold: 0.001 }),
    });
    expect(md).toContain("**Result: FAIL**");
    expect(md).toContain("## Overview");
    expect(md).toContain("`--secondary`: `#284b63` → `#c2185b` (1 shots)");
    expect(md).toContain("font-size: `28px` → `32px`");
    expect(md.indexOf("index@desktop-light | 5.00%")).toBeLessThan(
      md.indexOf("other@mobile-dark | 0.00%"),
    );
  });
});
