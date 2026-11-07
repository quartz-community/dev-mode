import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyOverlay,
  deepMerge,
  enabledPluginNames,
  extractDiagnostics,
  loadConfig,
  pluginNameFromSource,
  type QuartzConfig,
} from "../scripts/lib/sandbox.js";
import {
  basePathFromBaseUrl,
  normalizeBasePath,
  resolveSiteFile,
} from "../scripts/lib/static-server.js";
import { renderOverlay, renderReadme, renderSpec } from "../scripts/repro.js";

const base = (): QuartzConfig => ({
  configuration: {
    pageTitle: "T",
    baseUrl: "example.com",
    theme: { colors: { a: 1, b: 2 } },
  },
  plugins: [
    {
      source: "@quartz-community/graph",
      enabled: true,
      options: { localGraph: { depth: 1, zoom: true } },
    },
    { source: "github:quartz-community/explorer", enabled: true },
    {
      source: { repo: "https://github.com/x/my-plugin.git", name: "my-plugin" },
      enabled: false,
    },
  ],
});

describe("pluginNameFromSource", () => {
  it("handles npm, github, local and object sources", () => {
    expect(pluginNameFromSource("@quartz-community/graph")).toBe("graph");
    expect(pluginNameFromSource("github:quartz-community/explorer#v2")).toBe(
      "explorer",
    );
    expect(pluginNameFromSource("../search/")).toBe("search");
    expect(pluginNameFromSource({ repo: "https://github.com/a/b-c.git" })).toBe(
      "b-c",
    );
    expect(pluginNameFromSource({ repo: "x", name: "named" })).toBe("named");
  });
});

describe("deepMerge", () => {
  it("merges objects and replaces arrays/scalars", () => {
    expect(
      deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: 2 }),
    ).toEqual({
      a: { b: 1, c: [3] },
      d: 2,
    });
  });
});

describe("applyOverlay", () => {
  it("enables, disables and patches plugin options without mutating the base", () => {
    const cfg = base();
    const next = applyOverlay(cfg, {
      configuration: { theme: { colors: { b: 3 } } },
      enable: ["my-plugin"],
      disable: ["explorer"],
      plugins: { graph: { options: { localGraph: { depth: 2 } } } },
    });
    expect(enabledPluginNames(next)).toEqual(["graph", "my-plugin"]);
    expect(next.plugins[0].options).toEqual({
      localGraph: { depth: 2, zoom: true },
    });
    expect(next.configuration.theme).toEqual({ colors: { a: 1, b: 3 } });
    expect(enabledPluginNames(cfg)).toEqual(["graph", "explorer"]);
  });

  it("supports only: and rejects unknown plugins", () => {
    expect(
      enabledPluginNames(applyOverlay(base(), { only: ["explorer"] })),
    ).toEqual(["explorer"]);
    expect(() => applyOverlay(base(), { enable: ["nope"] })).toThrow(
      /not in the base config/,
    );
  });

  it("appends a new plugin when a source is given", () => {
    const next = applyOverlay(base(), {
      plugins: { extra: { source: "github:someone/extra" } },
    });
    expect(enabledPluginNames(next)).toContain("extra");
    expect(() =>
      applyOverlay(base(), { plugins: { extra: { enabled: true } } }),
    ).toThrow(/source/);
  });
});

describe("loadConfig", () => {
  it("resolves extends chains relative to the overlay file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sbx-"));
    writeFileSync(
      join(dir, "base.yaml"),
      "configuration:\n  pageTitle: Base\nplugins:\n  - source: '@quartz-community/graph'\n    enabled: true\n",
    );
    mkdirSync(join(dir, "sub"));
    writeFileSync(
      join(dir, "sub/overlay.yaml"),
      "extends: ../base.yaml\nconfiguration:\n  pageTitle: Over\ndisable: [graph]\n",
    );
    const cfg = loadConfig(join(dir, "sub/overlay.yaml"));
    expect(cfg.configuration.pageTitle).toBe("Over");
    expect(enabledPluginNames(cfg)).toEqual([]);
  });
});

describe("extractDiagnostics", () => {
  it("collects warnings/errors and skips export-conflict noise", () => {
    const log = [
      '\u001b[33m⚠\u001b[39m Export "X" conflicts across plugins — use ...',
      '⚠ Unknown condition "foo". Component will always render.',
      '✗ Failed to instantiate plugin "graph": boom',
      "Emitted 70 files",
    ].join("\n");
    const d = extractDiagnostics(log);
    expect(d.warnings).toEqual([
      '⚠ Unknown condition "foo". Component will always render.',
    ]);
    expect(d.errors).toEqual(['✗ Failed to instantiate plugin "graph": boom']);
  });

  it("keeps → hint lines with the diagnostic above them", () => {
    const log = [
      "✗ graph@1.0.0 failed to load its entry module: boom",
      "    → at /x/graph/dist/index.js:1:7",
      "Emitted 70 files",
      "→ stray hint without a diagnostic",
    ].join("\n");
    expect(extractDiagnostics(log).errors).toEqual([
      "✗ graph@1.0.0 failed to load its entry module: boom\n    → at /x/graph/dist/index.js:1:7",
    ]);
  });
});

describe("static server helpers", () => {
  it("derives base paths", () => {
    expect(basePathFromBaseUrl("localhost/bug-repro")).toBe("/bug-repro");
    expect(basePathFromBaseUrl("https://x.github.io/a/b/")).toBe("/a/b");
    expect(basePathFromBaseUrl("quartz.jzhao.xyz")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
  });

  it("resolves clean URLs and refuses traversal", () => {
    const dir = mkdtempSync(join(tmpdir(), "site-"));
    writeFileSync(join(dir, "index.html"), "i");
    writeFileSync(join(dir, "page.html"), "p");
    mkdirSync(join(dir, "folder"));
    writeFileSync(join(dir, "folder/index.html"), "f");
    expect(resolveSiteFile(dir, "/")).toBe(join(dir, "index.html"));
    expect(resolveSiteFile(dir, "/page")).toBe(join(dir, "page.html"));
    expect(resolveSiteFile(dir, "/folder/")).toBe(
      join(dir, "folder/index.html"),
    );
    expect(resolveSiteFile(dir, "/missing")).toBeNull();
    expect(resolveSiteFile(dir, "/../../etc/passwd")).toBeNull();
  });
});

describe("repro templates", () => {
  it("renders an overlay that loads and lists requested plugins", () => {
    const yaml = renderOverlay({
      from: "default",
      slug: "x",
      plugins: ["graph"],
    });
    expect(yaml).toContain("extends: default");
    expect(yaml).toMatch(/plugins:\n {2}graph:/);
    expect(renderReadme({ slug: "x", title: "T", plugins: [] })).toContain(
      "status: open",
    );
    expect(renderSpec({ slug: "x", title: "T" })).toContain("repro-fixture");
  });
});
