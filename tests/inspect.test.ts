import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatInspectReport,
  formatStyles,
  shortUrl,
  type PageInspection,
} from "../scripts/lib/inspect-report.js";
import {
  classifyPage,
  compactStyles,
  discoverPages,
  initScript,
  isConsoleNoise,
  normalizePage,
  pageFileName,
  pageUrlPath,
  parseCli,
  parseTheme,
  parseViewport,
  pickDefaultPages,
  rewriteSiteUrl,
  siteOriginPrefixes,
  splitList,
} from "../scripts/lib/page-probe.js";

describe("parseViewport", () => {
  it("resolves named viewports", () => {
    expect(parseViewport("mobile")).toMatchObject({
      width: 390,
      isMobile: true,
    });
    expect(parseViewport("desktop").width).toBeGreaterThanOrEqual(1200);
    const tablet = parseViewport("tablet");
    expect(tablet.width).toBeGreaterThan(800);
    expect(tablet.width).toBeLessThan(1200);
  });
  it("parses WxH and flags narrow widths as mobile", () => {
    expect(parseViewport("375x667")).toEqual({
      name: "375x667",
      width: 375,
      height: 667,
      isMobile: true,
    });
    expect(parseViewport("1920x1080").isMobile).toBe(false);
  });
  it("rejects garbage", () => {
    expect(() => parseViewport("huge")).toThrow(/Invalid viewport/);
    expect(() => parseTheme("sepia")).toThrow(/Invalid theme/);
  });
});

describe("page paths", () => {
  it("normalizes user input to slugs", () => {
    expect(normalizePage("")).toBe("index");
    expect(normalizePage("/")).toBe("index");
    expect(normalizePage("/docs/foo.html")).toBe("docs/foo");
    expect(normalizePage("docs/")).toBe("docs/index");
    expect(normalizePage("http://127.0.0.1:4000/features/callouts#x")).toBe(
      "features/callouts",
    );
  });
  it("maps slugs to URL paths and file names", () => {
    expect(pageUrlPath("index")).toBe("/");
    expect(pageUrlPath("docs/index")).toBe("/docs/");
    expect(pageUrlPath("docs/getting-started")).toBe("/docs/getting-started");
    expect(pageFileName("docs/getting-started")).toBe("docs__getting-started");
    expect(pageFileName("тест")).toBe("тест");
    expect(pageFileName("{Curly Title}")).toBe("-Curly-Title-");
  });
});

describe("page discovery", () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("classifies pages and skips redirects/404", () => {
    expect(classifyPage("404.html", "")).toBeUndefined();
    expect(
      classifyPage(
        "alias.html",
        '<meta http-equiv="refresh" content="0; url=x">',
      ),
    ).toBeUndefined();
    expect(classifyPage("index.html", "x")?.kind).toBe("index");
    expect(classifyPage("tags/foo.html", "x")?.kind).toBe("tag");
    expect(classifyPage("docs/index.html", "x")?.kind).toBe("folder");
    expect(classifyPage("docs/a.html", "x")?.kind).toBe("content");
  });

  it("picks index, the largest content pages, a folder and a specific tag", () => {
    dir = mkdtempSync(join(tmpdir(), "inspect-pages-"));
    const write = (rel: string, size: number) => {
      mkdirSync(join(dir!, rel, ".."), { recursive: true });
      writeFileSync(join(dir!, rel), "x".repeat(size));
    };
    write("index.html", 10);
    write("a.html", 100);
    write("b.html", 300);
    write("c.html", 200);
    write("d.html", 50);
    write("docs/index.html", 10);
    write("tags/index.html", 10);
    write("tags/foo.html", 10);
    write("static/ignored.html", 10);
    write("404.html", 10);
    const pages = discoverPages(dir);
    expect(pages.map((p) => p.slug)).not.toContain("static/ignored");
    expect(pickDefaultPages(pages)).toEqual([
      "index",
      "b",
      "c",
      "a",
      "docs/index",
      "tags/foo",
    ]);
  });
});

describe("parseCli", () => {
  it("keeps positionals after boolean flags and accumulates repeatables", () => {
    const cli = parseCli(
      [
        "fixture:x",
        "--screenshot",
        "index",
        "--selector",
        ".a",
        "--selector=.b",
        "--viewport",
        "mobile",
        "docs/x",
      ],
      { booleans: ["screenshot"], repeatable: ["selector"] },
    );
    expect(cli.positional).toEqual(["fixture:x", "index", "docs/x"]);
    expect(cli.flags).toEqual({ screenshot: true, viewport: "mobile" });
    expect(cli.lists.selector).toEqual([".a", ".b"]);
  });
  it("splits comma lists", () => {
    expect(splitList("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(splitList(undefined, ["x"])).toEqual(["x"]);
    expect(splitList(true, ["x"])).toEqual(["x"]);
  });
});

describe("site origin routing", () => {
  it("rewrites absolute public URLs to the local server", () => {
    const prefixes = siteOriginPrefixes("localhost/bug-repro");
    expect(
      rewriteSiteUrl(
        "https://localhost/bug-repro/static/f.ttf",
        prefixes,
        "http://127.0.0.1:5/bug-repro",
      ),
    ).toBe("http://127.0.0.1:5/bug-repro/static/f.ttf");
    expect(
      rewriteSiteUrl("https://fonts.googleapis.com/x", prefixes, "http://h"),
    ).toBeUndefined();
    expect(siteOriginPrefixes(undefined)).toEqual([]);
  });
  it("filters chromium GPU noise", () => {
    expect(
      isConsoleNoise(
        "[.WebGL-0x1]GL Driver Message (OpenGL, Performance): GPU stall due to ReadPixels",
      ),
    ).toBe(true);
    expect(isConsoleNoise("Uncaught TypeError")).toBe(false);
  });
  it("init script forces the theme and optionally freezes time", () => {
    expect(initScript("dark", false)).toContain(
      'localStorage.setItem("theme", "dark")',
    );
    expect(initScript("dark", false)).not.toContain("FrozenDate");
    expect(initScript("light", true)).toContain("FrozenDate");
  });
});

describe("inspect report formatting", () => {
  it("omits default styles", () => {
    expect(
      compactStyles({
        position: "static",
        display: "flex",
        "z-index": "auto",
        outline: "rgb(0, 0, 0) none 3px",
      }),
    ).toEqual({
      display: "flex",
    });
    expect(
      formatStyles({ display: "block", color: "rgb(1, 2, 3)", opacity: "1" }),
    ).toBe("display: block; color: rgb(1, 2, 3)");
    expect(shortUrl("http://127.0.0.1:41234/bug-repro/x")).toBe("/bug-repro/x");
  });

  it("renders a compact page report", () => {
    const page: PageInspection = {
      page: "index",
      url: "http://127.0.0.1:1234/base/",
      viewport: "mobile (390x844)",
      theme: "dark",
      status: 200,
      title: "Home",
      console: [{ type: "error", text: "boom" }],
      pageErrors: [],
      failedRequests: [
        { url: "http://127.0.0.1:1234/base/static/icon.png", status: 404 },
      ],
      layout: [
        {
          slot: "left",
          selector: ".left.sidebar",
          found: true,
          visible: true,
          box: { x: 0, y: 0, width: 390, height: 50 },
          children: [
            {
              tag: "h2",
              classes: "page-title",
              id: "",
              box: { x: 10, y: 10, width: 100, height: 30 },
              visible: true,
            },
            {
              tag: "div",
              classes: "toc",
              id: "",
              box: { x: 0, y: 0, width: 0, height: 0 },
              visible: false,
              reason: "display:none",
            },
          ],
        },
        { slot: "header", selector: "header", found: false, children: [] },
      ],
      overflow: {
        scrollWidth: 450,
        clientWidth: 390,
        overflowing: true,
        offenders: [{ selector: "pre.code", right: 450, width: 420 }],
      },
      selectors: [
        {
          selector: ".page-title",
          count: 1,
          boxes: [{ x: 10, y: 10, width: 100, height: 30, visible: true }],
          styles: { "font-size": "28px" },
        },
      ],
      screenshot: ".dev/inspect/x/index-mobile-dark.png",
    };
    const text = formatInspectReport(
      {
        target: "fixture:x",
        siteDir: ".dev/sites/x",
        basePath: "/base",
        warnings: ["⚠ stale"],
      },
      [page],
    );
    expect(text).toContain("== index  [mobile (390x844), dark]  200");
    expect(text).toContain("console: 1 errors, 0 warnings");
    expect(text).toContain("404 /base/static/icon.png");
    expect(text).toContain(
      "horizontal overflow: YES (scrollWidth 450 > viewport 390)",
    );
    expect(text).toMatch(/✗ div\.toc .*\(display:none\)/);
    expect(text).toContain("header       – not present");
    expect(text).toContain("styles[0] (defaults omitted): font-size: 28px");
    expect(text).toContain("screenshot: .dev/inspect/x/index-mobile-dark.png");
    expect(text).toContain("⚠ stale");
  });
});
