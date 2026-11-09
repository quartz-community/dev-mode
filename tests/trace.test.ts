import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPatches,
  PatchError,
  TRACE_PATCHES,
  type SourcePatch,
} from "../scripts/lib/trace/patches.js";
import { Recorder, type Actor } from "../scripts/lib/trace/recorder.js";
import {
  analyzeTrace,
  detectAnomalies,
  relativizeEmitted,
  renderMarkdown,
} from "../scripts/lib/trace/report.js";
import { normalizeOutput } from "../scripts/trace.js";

const QUARTZ = resolve(import.meta.dirname, "../repos/quartz");

const a = (kind: Actor["kind"], name: string): Actor => ({
  id: `${kind}:${name}`,
  kind,
  name,
});
const CORE_PARSE = a("core", "parse");
const CORE_PARSE_ID: Actor = { ...CORE_PARSE, id: "core:parse" };
const VIRTUAL: Actor = {
  id: "core:virtual-page",
  kind: "core",
  name: "virtual",
};

describe("applyPatches", () => {
  const patches: SourcePatch[] = [
    {
      id: "after",
      file: "a.ts",
      anchor: "import x\n",
      position: "after",
      text: "hook()\n",
      purpose: "t",
    },
    {
      id: "replace",
      file: "a.ts",
      anchor: "data = v",
      position: "replace",
      text: "data = wrap(v)",
      purpose: "t",
    },
    {
      id: "before",
      file: "b.ts",
      anchor: "end()",
      position: "before",
      text: "flush(); ",
      purpose: "t",
    },
  ];

  it("applies anchored edits", () => {
    const out = applyPatches(
      { "a.ts": "import x\nconst data = v\n", "b.ts": "start(); end()" },
      patches,
    );
    expect(out["a.ts"]).toBe("import x\nhook()\nconst data = wrap(v)\n");
    expect(out["b.ts"]).toBe("start(); flush(); end()");
  });

  it("is idempotent", () => {
    const once = applyPatches(
      { "a.ts": "import x\nconst data = v\n", "b.ts": "end()" },
      patches,
    );
    expect(applyPatches(once, patches)).toEqual(once);
  });

  it("reports every missing or ambiguous anchor at once", () => {
    try {
      applyPatches({ "a.ts": "import y\ndata = v; data = v" }, patches);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError);
      const failures = (err as PatchError).failures;
      expect(failures).toHaveLength(3);
      expect(failures[0]).toMatch(
        /after: expected exactly 1 occurrence .* found 0/,
      );
      expect(failures[1]).toMatch(/replace: .* found 2/);
      expect(failures[2]).toMatch(/before: file b.ts not found/);
      expect((err as Error).message).toMatch(/Update TRACE_PATCHES/);
    }
  });

  it.skipIf(!existsSync(join(QUARTZ, "quartz/build.ts")))(
    "anchors still match the current Quartz checkout",
    () => {
      const sources: Record<string, string> = {};
      for (const p of TRACE_PATCHES)
        sources[p.file] = readFileSync(join(QUARTZ, p.file), "utf-8");
      const out = applyPatches(sources);
      expect(out["quartz/build.ts"]).toContain("__traceInstrument(cfg)");
      expect(out["quartz/plugins/vfile.ts"]).toContain(
        "__traceWrapVirtual(vfileData)",
      );
    },
  );
});

describe("Recorder", () => {
  it("detects read-before-write and overwrites per file", () => {
    const rec = new Recorder();
    const toc = a("transformer", "Toc");
    const fm = a("transformer", "Frontmatter");
    const desc = a("transformer", "Description");
    const f1 = rec.newFile("a");
    const f2 = rec.newFile("b");
    rec.seed(f1, ["slug"], CORE_PARSE_ID);
    rec.read(f1, "frontmatter", toc, false); // too early
    rec.write(f1, "frontmatter", fm);
    rec.read(f1, "frontmatter", toc, true);
    rec.read(f2, "frontmatter", fm, false);
    rec.write(f2, "frontmatter", fm); // self read-before-write is fine
    rec.write(f1, "frontmatter", desc); // clobber
    rec.write(f1, "slug", fm); // overwrites a core seed
    const raw = rec.toJSON();
    expect(raw.readBeforeWrite).toEqual([
      { key: "frontmatter", from: toc.id, to: fm.id, files: 1 },
    ]);
    expect(raw.overwrites).toEqual(
      expect.arrayContaining([
        { key: "frontmatter", from: fm.id, to: desc.id, files: 1 },
        { key: "slug", from: "core:parse", to: fm.id, files: 1 },
      ]),
    );
    expect(raw.actors.find((s) => s.id === toc.id)!.misses).toEqual({
      frontmatter: 1,
    });
  });

  it("tracks execution order, files, steps, page types and components", () => {
    const rec = new Recorder();
    const first = a("transformer", "First");
    const second = a("transformer", "Second");
    const file = rec.newFile("index");
    rec.call(second, 2, file, "md#0");
    rec.call(first, 1, file);
    rec.call(second, 3, rec.newFile("other"), "md#0");
    rec.assignPageType("index", "ContentPage");
    rec.assignPageType("index", "FolderPage"); // first match wins
    rec.rendered("Backlinks", "index");
    rec.rendered("Backlinks", "index");
    const raw = rec.toJSON();
    expect(raw.actors.map((s) => s.name)).toEqual(["Second", "First"]);
    const s = raw.actors[0]!;
    expect(s).toMatchObject({
      calls: 2,
      timeMs: 5,
      files: 2,
      steps: { "md#0": { calls: 2, timeMs: 5 } },
    });
    expect(raw.pageTypes).toEqual({ ContentPage: ["index"] });
    expect(raw.components).toEqual({ ContentPage: { Backlinks: 1 } });
  });
});

describe("report", () => {
  function sampleTrace() {
    const rec = new Recorder();
    const crawl = a("transformer", "CrawlLinks");
    const toc = a("transformer", "Toc");
    const og = a("transformer", "OtherWriter");
    const index = a("emitter", "ContentIndex");
    const backlinks = a("component", "Backlinks");
    const f = rec.newFile("index");
    const v = rec.newFile("tags/x");
    rec.seed(f, ["slug"], CORE_PARSE_ID);
    rec.seed(v, ["slug", "description"], VIRTUAL);
    rec.call(toc, 1, f);
    rec.read(f, "links", toc, false);
    rec.call(crawl, 1, f);
    rec.write(f, "links", crawl);
    rec.write(f, "links", og);
    rec.read(f, "links", backlinks, true);
    rec.read(f, "unlisted", index, false);
    rec.read(f, "description", index, false);
    rec.emitted(index, "/tmp/sb/public/static/contentIndex.json");
    return rec.toJSON();
  }

  it("classifies anomalies", () => {
    const anomalies = detectAnomalies(sampleTrace());
    const byKind = (k: string) =>
      anomalies.filter((x) => x.kind === k).map((x) => x.key);
    expect(byKind("read-before-write")).toEqual(["links"]);
    expect(byKind("multiple-writers")).toEqual(["links"]);
    expect(byKind("never-produced")).toEqual(["unlisted"]);
    expect(byKind("virtual-only")).toEqual(["description"]);
    expect(
      anomalies.find((x) => x.kind === "multiple-writers")!.message,
    ).toMatch(/overwrites on the same file/);
  });

  it("renders a readable markdown summary", () => {
    const report = analyzeTrace(sampleTrace(), "fixture:test");
    const md = renderMarkdown(report);
    expect(md).toContain("# Runtime trace: fixture:test");
    expect(md).toContain("### Read before write (1)");
    expect(md).toMatch(
      /\| `links` \| transformer:CrawlLinks, transformer:OtherWriter \|/,
    );
    expect(md).toContain("static/contentIndex.json");
    expect(report.pipeline.map((p) => p.id)).toEqual([
      "transformer:Toc",
      "transformer:CrawlLinks",
    ]);
  });

  it("relativizes emitted paths and normalizes timestamps", () => {
    expect(relativizeEmitted("/x/sandbox/public/a/b.html")).toBe("a/b.html");
    expect(relativizeEmitted("public/c.html")).toBe("c.html");
    expect(normalizeOutput('{"date":"2026-11-07T00:45:53.683Z"}')).toBe(
      '{"date":"<ts>"}',
    );
  });
});
