import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildCatalog,
  readmeParagraph,
  summarizeQuartzField,
} from "../scripts/lib/catalog/build.js";
import {
  domLookup,
  findPackage,
  impact,
  search,
  whoAccesses,
} from "../scripts/lib/catalog/query.js";
import { renderCard, renderDataFlowMd } from "../scripts/lib/catalog/render.js";
import {
  analyzeSource,
  analyzeStylesheet,
  resolvePhases,
  selectorTokens,
} from "../scripts/lib/catalog/source-analysis.js";
import type { Manifest } from "../scripts/lib/types.js";

const keys = (
  facts: ReturnType<typeof analyzeSource>,
  mode: "read" | "write",
) =>
  [
    ...new Set(facts.accesses.filter((a) => a.mode === mode).map((a) => a.key)),
  ].sort();

describe("analyzeSource — data access", () => {
  it("attributes reads and writes to the enclosing transformer hook", () => {
    const f = analyzeSource(
      "src/transformer.ts",
      `export const T = () => ({
        name: "T",
        htmlPlugins() {
          return [() => (tree, file) => {
            const slug = file.data.slug;
            file.data.links = [slug];
          }];
        },
      });`,
    );
    expect(keys(f, "read")).toEqual(["slug"]);
    expect(keys(f, "write")).toEqual(["links"]);
    expect(f.accesses.every((a) => a.hook === "htmlPlugins")).toBe(true);
    expect([...f.hooks]).toEqual(["htmlPlugins"]);
  });

  it("classifies assignment operators, delete, mutation and Object.assign as writes", () => {
    const f = analyzeSource(
      "src/x.ts",
      `function p(file) {
        file.data.a ??= [];
        file.data.b.push(1);
        delete file.data.c;
        file.data.d.nested = 1;
        Object.assign(file.data, { e: 1 });
        const data = (file.data as Record<string, unknown>) ?? {};
        data.f = true;
        if (data.g) {}
        file.data.h.startsWith("x");
        file.data.slug.endsWith("/index");
      }`,
    );
    expect(keys(f, "write")).toEqual(["a", "b", "c", "d", "e", "f"]);
    // method calls on a key are not keys themselves; `h`/`slug` are reads
    expect(keys(f, "read")).toEqual(["g", "h", "slug"]);
  });

  it("tracks fileData, destructuring, allFiles callbacks and frontmatter fields in components", () => {
    const f = analyzeSource(
      "src/components/C.tsx",
      `export default (() => {
        const C = ({ fileData, allFiles, displayClass }) => {
          const { toc, collapseToc } = fileData;
          const back = allFiles.filter((page) => page.links?.includes(fileData.slug));
          const title = fileData.frontmatter?.title;
          return <div class={classNames(displayClass, "backlinks")} id="bl"><a class="internal alias">{title}</a></div>;
        };
        C.css = style;
        C.afterDOMLoaded = script;
        return C;
      })`,
    );
    expect(keys(f, "read")).toEqual([
      "collapseToc",
      "frontmatter",
      "links",
      "slug",
      "toc",
    ]);
    expect(f.frontmatter.map((x) => x.field)).toEqual(["title"]);
    expect([...f.renderedClasses].sort()).toEqual([
      "alias",
      "backlinks",
      "internal",
    ]);
    expect([...f.renderedIds]).toEqual(["bl"]);
    expect([...f.hooks].sort()).toEqual(["afterDOMLoaded", "css"]);
  });

  it("does not treat BuildCtx.allFiles (FilePath[]) or font arrays as file data", () => {
    const f = analyzeSource(
      "src/e.ts",
      `function e(ctx, fontFiles) {
        ctx.allFiles.filter((fp) => fp.endsWith(".md")).map((fp) => fp.length);
        for (const fontFile of fontFiles) fontFile.url;
      }`,
    );
    expect(f.accesses).toEqual([]);
  });

  it("records frontmatter alias writes as frontmatter mutation", () => {
    const f = analyzeSource(
      "src/t.ts",
      `function x(file) {
        const frontmatter = file.data.frontmatter as { tags?: string[] };
        frontmatter.tags = ["a"];
      }`,
    );
    expect(f.frontmatter).toMatchObject([{ field: "tags", mode: "write" }]);
    expect(keys(f, "write")).toContain("frontmatter");
  });

  it("parses vfile DataMap augmentations", () => {
    const f = analyzeSource(
      "src/t.ts",
      `declare module "vfile" { interface DataMap { toc: { depth: number }[]; collapseToc?: boolean } }`,
    );
    expect(f.dataMap.map((d) => [d.key, d.type, d.optional])).toEqual([
      ["toc", "{ depth: number }[]", false],
      ["collapseToc", "boolean", true],
    ]);
  });

  it("records VirtualPage data literals as writes and pageType hooks", () => {
    const f = analyzeSource(
      "src/pageType.ts",
      `export const P = () => ({
        name: "P", match: m, layout: "tag", body: B,
        generate() { return [{ slug: "tags/x", title: "x", data: { frontmatter: {}, links: [] } }]; },
      });`,
    );
    expect(keys(f, "write")).toEqual(["frontmatter", "links"]);
    expect(f.accesses[0].hook).toBe("generate");
    expect([...f.hooks].sort()).toEqual([
      "body",
      "generate",
      "layout",
      "match",
    ]);
  });

  it("skips data analysis for client scripts", () => {
    const f = analyzeSource(
      "src/components/scripts/s.inline.ts",
      `const fileData = idx[slug]; fileData.title;`,
    );
    expect(f.accesses).toEqual([]);
  });
});

describe("resolvePhases", () => {
  it("propagates hook membership through named helpers across files", () => {
    const a = analyzeSource(
      "src/index.ts",
      `import { remarkThing } from "./lib"; export const T = () => ({ name: "T", markdownPlugins: () => [remarkThing] });`,
    );
    const b = analyzeSource(
      "src/lib.ts",
      `function inner(file) { file.data.dates = {}; }
       export function remarkThing() { return (tree, file) => inner(file); }`,
    );
    const phases = resolvePhases([a, b]);
    expect([...(phases.get("remarkThing") ?? [])]).toEqual(["markdownPlugins"]);
    expect([...(phases.get("inner") ?? [])]).toEqual(["markdownPlugins"]);
    expect(b.accesses[0].enclosing).toContain("inner");
  });
});

describe("analyzeSource — browser and emitter facts", () => {
  it("collects events, storage keys, fetches and queried selectors", () => {
    const f = analyzeSource(
      "src/components/scripts/graph.inline.ts",
      `var storageKey = "graph-visited";
       document.addEventListener("nav", h);
       window.addEventListener("resize", h);
       el.addEventListener("click", h);
       document.dispatchEvent(new CustomEvent("themechange", { detail: {} }));
       localStorage.getItem(storageKey);
       sessionStorage.setItem("scroll", "1");
       const data = await fetchData;
       fetch("/static/contentIndex.json");
       document.querySelectorAll("div.graph-container > .node, #global-graph");
       el.classList.toggle("active");
       window.addCleanup(() => {});`,
    );
    expect([...f.listens].sort()).toEqual(["document:nav", "window:resize"]);
    expect([...f.dispatches]).toEqual(["themechange"]);
    expect([...f.localStorage]).toEqual(["graph-visited"]);
    expect([...f.sessionStorage]).toEqual(["scroll"]);
    expect([...f.fetches].sort()).toEqual([
      "/static/contentIndex.json",
      "fetchData (contentIndex.json, provided by core)",
    ]);
    expect([...f.scriptedClasses].sort()).toEqual([
      "active",
      "graph-container",
      "node",
    ]);
    expect([...f.scriptedIds]).toEqual(["global-graph"]);
    expect(f.usesAddCleanup).toBe(true);
  });

  it("collects emitted paths from write() calls in both signatures", () => {
    const f = analyzeSource(
      "src/emitter.ts",
      `async function* emit(ctx) {
         yield write({ ctx, content: "", slug: "sitemap" as FullSlug, ext: ".xml" });
         yield write(ctx, "CNAME" as FullSlug, "", content);
         yield write({ ctx, content: "", slug: fp, ext: ".json" });
       }`,
    );
    expect(f.emits.map((e) => e.path)).toEqual([
      "sitemap.xml",
      "CNAME",
      "<fp>.json",
    ]);
  });

  it("collects rendered classes from hast properties, class arrays and HTML strings", () => {
    const f = analyzeSource(
      "src/transformer.ts",
      `const classes = (node.properties.className ?? []);
       classes.push("external", "external-link");
       const classNames = ["callout", calloutType];
       const n = { type: "element", properties: { className: ["toc-entry"] } };
       const html = \`<div class="callout-title"><span id="x-1">\${t}</span></div>\`;`,
    );
    expect([...f.renderedClasses].sort()).toEqual([
      "callout",
      "callout-title",
      "external",
      "external-link",
      "toc-entry",
    ]);
    expect([...f.renderedIds]).toEqual(["x-1"]);
  });

  it("records dynamic class suffixes as wildcards", () => {
    const f = analyzeSource(
      "src/C.tsx",
      "const C = () => <li class={`depth-${n} toc-item`} />;",
    );
    expect([...f.renderedClasses].sort()).toEqual(["depth-*", "toc-item"]);
  });
});

describe("stylesheets and selectors", () => {
  it("extracts classes and ids from SCSS selectors only", () => {
    const r = analyzeStylesheet(`
      // line comment .not-me
      /* .nor-me */
      .graph { color: #fff; margin: 0.5rem;
        & > .graph-outer:hover { border: 1px solid #abcdef; }
        &.active { opacity: 1.5; }
      }
      @media (max-width: 600px) { #search-root .result-card { display: none; } }
      .icon-#{$name} { x: y; }
      button.search-button, a[href$=".pdf"] { y: z; }
    `);
    expect(r.classes).toEqual([
      "active",
      "graph",
      "graph-outer",
      "icon-x",
      "result-card",
      "search-button",
    ]);
    expect(r.ids).toEqual(["search-root"]);
  });

  it("selectorTokens handles tag-qualified selectors and interpolation", () => {
    expect(selectorTokens("button.search-button#go")).toEqual({
      classes: ["search-button"],
      ids: ["go"],
    });
    expect(selectorTokens("#popover-${id}").ids).toEqual([]);
    expect(selectorTokens("1.5em .x").classes).toEqual(["x"]);
  });
});

describe("package metadata helpers", () => {
  it("normalises the quartz manifest field", () => {
    const q = summarizeQuartzField({
      category: "component",
      defaultOrder: 50,
      defaultOptions: { a: 1, b: 2 },
      components: { Graph: { defaultPosition: "right", defaultPriority: 10 } },
    });
    expect(q?.category).toEqual(["component"]);
    expect(q?.defaultOptionKeys).toEqual(["a", "b"]);
    expect(q?.components.Graph.defaultPosition).toBe("right");
    expect(
      summarizeQuartzField({ category: ["transformer", "emitter"] })?.category,
    ).toEqual(["transformer", "emitter"]);
  });

  it("extracts the first prose paragraph of a README", () => {
    const md = `# Title\n\n[![badge](x)](y)\n\nThis plugin renders a [graph](https://x) of\nyour notes for Quartz.\n\n## Usage`;
    expect(readmeParagraph(md)).toBe(
      "This plugin renders a graph of your notes for Quartz.",
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end over a synthetic workspace
// ---------------------------------------------------------------------------

let root: string;

function write(rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

const manifest: Manifest = {
  version: 1,
  org: "quartz-community",
  core: { repo: "jackyzha0/quartz" },
  infrastructure: [{ name: "types", repo: "quartz-community/types" }],
  plugins: [
    { name: "producer" },
    { name: "consumer" },
    { name: "early" },
    { name: "fonts" },
  ],
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "catalog-test-"));
  const pkg = (name: string, extra: object = {}) =>
    JSON.stringify({ name, version: "1.0.0", ...extra });
  write("repos/types/package.json", pkg("@quartz-community/types"));
  write(
    "repos/types/src/index.ts",
    `declare module "vfile" { interface DataMap { slug: string; links: string[]; ghost: number } }`,
  );
  write(
    "repos/quartz/package.json",
    pkg("@jackyzha0/quartz", {
      dependencies: {
        "@quartz-community/producer": "^1",
        "@quartz-community/consumer": "^1",
      },
    }),
  );
  write(
    "repos/quartz/quartz/processors/parse.ts",
    `export function p(file) { file.data.slug = "x"; }`,
  );
  write(
    "repos/quartz/quartz/components/Ghost.tsx",
    `export const G = ({ fileData }) => fileData.ghost;`,
  );
  write(
    "repos/producer/package.json",
    pkg("@quartz-community/producer", {
      description: "Produces links",
      dependencies: { "@quartz-community/types": "^1" },
      quartz: { category: "transformer", defaultOrder: 60 },
    }),
  );
  write(
    "repos/producer/src/index.ts",
    `export const Producer = () => ({ name: "Producer", htmlPlugins: () => [() => (t, file) => { file.data.links = []; file.data.shared = 1; }] });`,
  );
  write("repos/producer/test/producer.test.ts", "");
  write(
    "repos/early/package.json",
    pkg("@quartz-community/early", {
      quartz: { category: "transformer", defaultOrder: 10 },
    }),
  );
  write(
    "repos/early/src/index.ts",
    `export const Early = () => ({ name: "Early", htmlPlugins: () => [() => (t, file) => { if (file.data.links) {} file.data.shared = 2; }] });`,
  );
  write(
    "repos/consumer/package.json",
    pkg("@quartz-community/consumer", {
      dependencies: { "@quartz-community/types": "^1" },
      quartz: {
        category: "component",
        components: {
          Backlinks: { defaultPosition: "right", defaultPriority: 30 },
        },
      },
    }),
  );
  write(
    "repos/consumer/src/index.ts",
    `export { default as Backlinks } from "./components/Backlinks";`,
  );
  write(
    "repos/consumer/src/components/Backlinks.tsx",
    `export default () => ({ fileData, allFiles }) => <ul class="backlinks">{allFiles.filter((f) => f.links.includes(fileData.slug))}</ul>;`,
  );
  write(
    "repos/consumer/src/components/styles/backlinks.scss",
    `.backlinks { ul { margin: 0; } }`,
  );
  write(
    "repos/fonts/package.json",
    pkg("@quartz-community/quartz-fonts", {
      quartz: { category: ["transformer", "emitter"] },
    }),
  );
  write(
    "repos/fonts/src/index.ts",
    `export const ExampleEmitter = () => ({ name: "E", emit: () => [] });`,
  );
  write(
    "e2e/fixtures/site/quartz.config.yaml",
    `plugins:\n  - source: "@quartz-community/consumer"\n    enabled: true\n  - source: github:quartz-community/producer\n  - source: "@quartz-community/quartz-fonts"\n    enabled: false\n`,
  );
  write(
    "e2e/playwright.config.ts",
    `env: { FIXTURE: "site", BASE_PATH: "/x", PORT: "4999" },`,
  );
  write(
    "e2e/tests/site.spec.ts",
    `const ORIGIN = "http://localhost:4999"; page.locator("ul.backlinks");`,
  );
  write("e2e/tests/other.spec.ts", `page.locator(".nothing");`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildCatalog (synthetic workspace)", () => {
  it("classifies packages and links workspace dependencies both ways", () => {
    const cat = buildCatalog({ workspaceRoot: root, manifest });
    const by = (d: string) => cat.packages.find((p) => p.dir === d)!;
    expect(by("quartz").kind).toBe("core");
    expect(by("types").kind).toBe("infrastructure");
    expect(by("producer").kind).toBe("plugin");
    expect(by("producer").testFiles).toBe(1);
    expect(by("types").dependents).toEqual(["consumer", "producer"]);
    expect(by("fonts").npmName).toBe("@quartz-community/quartz-fonts");
  });

  it("builds the data-flow graph with producers, consumers and flags", () => {
    const cat = buildCatalog({ workspaceRoot: root, manifest });
    const flow = (k: string) => cat.dataFlow.find((f) => f.key === k)!;
    expect(flow("links").producers.map((p) => p.pkg)).toEqual(["producer"]);
    expect(
      flow("links")
        .consumers.map((p) => p.pkg)
        .sort(),
    ).toEqual(["consumer", "early"]);
    expect(flow("links").type).toBe("string[]");
    expect(flow("slug").producers).toEqual([
      { pkg: "quartz", phases: ["parse"] },
    ]);
    expect(flow("ghost").status).toBe("consumed-never-produced");
    expect(flow("ghost").declaredBy).toEqual(["types"]);
    expect(
      whoAccesses(cat, "links", "read")
        .map((h) => h.pkg)
        .sort(),
    ).toEqual(["consumer", "early"]);
  });

  it("orders transformers and detects ordering hazards and multiple writers", () => {
    const cat = buildCatalog({ workspaceRoot: root, manifest });
    expect(cat.pipeline.transformers.map((s) => s.pkg)).toEqual([
      "early",
      "fonts",
      "producer",
    ]);
    expect(cat.hazards).toHaveLength(1);
    expect(cat.hazards[0]).toMatchObject({
      consumer: "early",
      producer: "producer",
      key: "links",
    });
    expect(cat.multiWriters).toEqual([
      {
        key: "shared",
        writers: [
          { pkg: "early", phase: "htmlPlugins", order: 10 },
          { pkg: "producer", phase: "htmlPlugins", order: 60 },
        ],
      },
    ]);
    expect(renderDataFlowMd(cat)).toContain(
      "early reads `links` in htmlPlugins (order 10)",
    );
  });

  it("flags template scaffolding and categories without hooks", () => {
    const cat = buildCatalog({ workspaceRoot: root, manifest });
    const fonts = cat.packages.find((p) => p.dir === "fonts")!;
    expect(fonts.warnings.join("\n")).toMatch(/scaffolding: ExampleEmitter/);
    expect(fonts.warnings.join("\n")).toMatch(
      /category includes transformer but no transformer hook/,
    );
  });

  it("maps fixtures/specs to packages for impact analysis", () => {
    const cat = buildCatalog({ workspaceRoot: root, manifest });
    expect(cat.fixtures).toEqual([
      {
        name: "site",
        kind: "fixture",
        dir: "e2e/fixtures/site",
        plugins: ["consumer", "producer"],
      },
    ]);
    const r = impact(
      cat,
      findPackage(cat, "@quartz-community/consumer")!,
      root,
    );
    expect(r.fixtures.map((f) => f.name)).toEqual(["site"]);
    expect(r.specs.map((s) => s.file)).toEqual(["e2e/tests/site.spec.ts"]);
    expect(r.specs[0].reasons.join(" ")).toMatch(/selects \.backlinks/);
    expect(r.commands).toContain("just build-plugin consumer");
    expect(r.commands).toContain("just e2e-build site");

    const t = impact(cat, findPackage(cat, "types")!, root);
    expect(t.transitiveDependents).toEqual(["consumer", "producer", "quartz"]);
    expect(t.commands).toContain("just typecheck");
  });

  it("answers dom, search and lookup queries", () => {
    const cat = buildCatalog({ workspaceRoot: root, manifest });
    expect(domLookup(cat, "ul.backlinks")).toEqual([
      {
        pkg: "consumer",
        token: ".backlinks",
        roles: ["renders", "styles"],
        exact: true,
      },
    ]);
    expect(domLookup(cat, "backl")[0]).toMatchObject({
      pkg: "consumer",
      exact: false,
    });
    const hits = search(cat, "links");
    expect(hits.map((h) => h.pkg)).toEqual(
      expect.arrayContaining(["producer", "consumer"]),
    );
    expect(hits.find((h) => h.pkg === "producer")?.matches).toContain(
      "provides: links",
    );
    expect(findPackage(cat, "quartz-fonts")?.dir).toBe("fonts");
    expect(findPackage(cat, "Backlinks")?.dir).toBe("consumer");
    const card = renderCard(findPackage(cat, "consumer")!);
    expect(card).toContain("Backlinks → right (prio 30)");
    expect(card).toContain("`links` (component)");
  });
});
