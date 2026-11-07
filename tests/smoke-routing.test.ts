import { describe, expect, it } from "vitest";
import {
  baseUrlHost,
  productionUrlToSitePath,
} from "../scripts/lib/page-routing.js";
import { internalTargets, pagePathFor } from "../scripts/smoke.js";

describe("pagePathFor", () => {
  it("maps html files to site paths", () => {
    expect(pagePathFor("index.html")).toBe("");
    expect(pagePathFor("docs/index.html")).toBe("docs/");
    expect(pagePathFor("docs/page.html")).toBe("docs/page");
  });
});

describe("internalTargets", () => {
  const html = `<a href="./other">x</a><a href="../up">u</a><a href="https://ext.com/a">e</a>
    <img src="static/i.png"><a href="#h">h</a><a href="mailto:a@b">m</a><a href="/elsewhere">o</a>`;
  it("resolves relative refs against the page and drops external/anchors", () => {
    const t = internalTargets(html, "docs/page", "/base").map((x) => x.target);
    expect(t).toEqual([
      "/docs/other",
      "/up",
      "/docs/static/i.png",
      "(outside base path) /elsewhere",
    ]);
  });
  it("works without a base path", () => {
    expect(
      internalTargets('<a href="./tags/x">t</a>', "", "").map((x) => x.target),
    ).toEqual(["/tags/x"]);
  });
});

describe("production URL routing", () => {
  it("parses baseUrl host and path", () => {
    expect(baseUrlHost("localhost/bug-repro")).toEqual({
      host: "localhost",
      basePath: "/bug-repro",
    });
    expect(baseUrlHost("quartz.jzhao.xyz")).toEqual({
      host: "quartz.jzhao.xyz",
      basePath: "",
    });
    expect(baseUrlHost("")).toBeNull();
  });
  it("maps production URLs to site paths", () => {
    expect(
      productionUrlToSitePath(
        "https://localhost/bug-repro/static/f.ttf",
        "localhost",
        "/bug-repro",
      ),
    ).toBe("/static/f.ttf");
    expect(
      productionUrlToSitePath(
        "https://localhost/other/x",
        "localhost",
        "/bug-repro",
      ),
    ).toBeNull();
    expect(
      productionUrlToSitePath("https://evil.com/x", "localhost", ""),
    ).toBeNull();
  });
});

import { relevantChanges } from "../scripts/changed.js";

describe("relevantChanges", () => {
  it("drops build noise and tolerates a trimmed first line", () => {
    const porcelain = [
      "M .gitignore",
      " M src/a.ts",
      "?? dist/index.js",
      "?? quartz/.quartz-cache/x",
      "R  old.ts -> new.ts",
      " M .turbo/log",
    ].join("\n");
    expect(relevantChanges(porcelain)).toEqual(["src/a.ts", "new.ts"]);
  });
});
