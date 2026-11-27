import { build, transform } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  alignJoinedScript,
  analyzeCoverage,
  countAt,
  enumerateFunctions,
  fingerprintOwner,
  literalFunctions,
  locateLiterals,
  summarizePlugins,
  type CoverageDump,
  type LiteralMatch,
  type ScriptLiteral,
  type V8Function,
} from "../scripts/lib/e2e-coverage/analyze.js";
import {
  extractInlineLiterals,
  inlineVarStem,
  stringTokens,
} from "../scripts/lib/e2e-coverage/discover.js";
import {
  decodeVlqSegment,
  SourceMapLookup,
  type RawSourceMap,
} from "../scripts/lib/e2e-coverage/sourcemap.js";

const tmp = mkdtempSync(join(tmpdir(), "e2e-coverage-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const HELPER = `export function slugOf(el: HTMLElement): string {
  return el.dataset.slug ?? ""
}
`;

const INLINE = `import { slugOf } from "./helper"

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closePanel()
}

function closePanel() {
  document.body.classList.remove("panel-open")
}

document.addEventListener("nav", () => {
  const body = document.body
  console.log(slugOf(body))
  document.addEventListener("keydown", onKeydown)
  window.addCleanup(() => document.removeEventListener("keydown", onKeydown))
})
`;

/** Build like a plugin's inline-script-loader, plus a source map. */
async function buildLiteral(): Promise<ScriptLiteral> {
  writeFileSync(join(tmp, "helper.ts"), HELPER);
  writeFileSync(join(tmp, "panel.inline.ts"), INLINE);
  const result = await build({
    stdin: {
      contents: INLINE,
      loader: "ts",
      resolveDir: tmp,
      sourcefile: "panel.inline.ts",
    },
    write: false,
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    sourcemap: "external",
    outfile: join(tmp, "out.js"),
    logLevel: "silent",
  });
  const js = result.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const map = JSON.parse(
    result.outputFiles.find((f) => f.path.endsWith(".map"))!.text,
  ) as RawSourceMap;
  return {
    id: "panel:panel.inline.ts",
    plugin: "panel",
    file: "panel/panel.inline.ts",
    code: js,
    map: new SourceMapLookup(map, js),
    kind: "inline",
    resolveSource: (source) => ({
      display: `panel/${source.replace(/^.*\//, "")}`,
      own: !source.endsWith("helper.ts"),
    }),
  };
}

/** V8-like coverage: every function range, count 1 when `run(fn)`, else 0. */
function fakeCoverage(
  code: string,
  run: (fnIndex: number) => boolean,
): V8Function[] {
  const fns = enumerateFunctions(code);
  return [
    {
      functionName: "",
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
    },
    ...fns.map((f, i) => ({
      functionName: f.minName ?? "",
      isBlockCoverage: true,
      ranges: [
        { startOffset: f.start, endOffset: f.end, count: run(i) ? 1 : 0 },
      ],
    })),
  ];
}

describe("sourcemap", () => {
  it("decodes VLQ segments", () => {
    expect(decodeVlqSegment("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeVlqSegment("CACD")).toEqual([1, 0, 1, -1]);
    expect(decodeVlqSegment("gBAAgB")).toEqual([16, 0, 0, 16]);
  });

  it("recovers original names of minified functions", async () => {
    const lit = await buildLiteral();
    const fns = literalFunctions(lit);
    const names = fns.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["slugOf", "onKeydown", "closePanel"]),
    );
    const keydown = fns.find((f) => f.name === "onKeydown")!;
    expect(keydown.location).toBe("panel/panel.inline.ts:3");
    expect(keydown.own).toBe(true);
    expect(fns.find((f) => f.name === "slugOf")!.own).toBe(false);
    // anonymous callbacks are named by the call they are passed to
    expect(fns.map((f) => f.context)).toEqual(
      expect.arrayContaining([
        'addEventListener("nav") callback',
        "addCleanup() callback",
      ]),
    );
  });
});

describe("enumerateFunctions", () => {
  it("lists functions with names, contexts and body offsets", () => {
    const code =
      'function a(x){return x}const b=()=>1;el.onclick=function(){};o={m(){},k:y=>y};document.addEventListener("keydown",e=>e)';
    const fns = enumerateFunctions(code);
    expect(fns.map((f) => f.minName ?? f.context)).toEqual([
      "a",
      "b",
      "onclick",
      "m",
      "k",
      'addEventListener("keydown") callback',
    ]);
    expect(code.slice(fns[0].bodyStart, fns[0].bodyStart + 1)).toBe("{");
    expect(fns[0].params).toBe(1);
  });
});

describe("countAt", () => {
  it("uses the innermost range", () => {
    const fns: V8Function[] = [
      {
        functionName: "",
        isBlockCoverage: true,
        ranges: [
          { startOffset: 0, endOffset: 100, count: 1 },
          { startOffset: 10, endOffset: 20, count: 0 },
        ],
      },
      {
        functionName: "f",
        isBlockCoverage: true,
        ranges: [{ startOffset: 30, endOffset: 40, count: 3 }],
      },
    ];
    expect(countAt(fns, 5)).toBe(1);
    expect(countAt(fns, 15)).toBe(0);
    expect(countAt(fns, 35)).toBe(3);
    expect(countAt(fns, 200)).toBeUndefined();
  });
});

describe("locateLiterals", () => {
  it("finds literals behind a prefix and does not overlap matches", () => {
    const served = 'window.__mode="hover";\nfunction a(){}function b(){}\n';
    const matches = locateLiterals(served, [
      { id: "ab", code: "function a(){}function b(){}\n" },
      { id: "b", code: "function b(){}" },
    ]);
    expect(matches.map((m) => m.literalId)).toEqual(["ab"]);
    expect(matches[0].toServed(0)).toBe(served.indexOf("function a"));
  });
});

describe("alignJoinedScript", () => {
  it("maps functions of re-minified, prefixed and joined scripts", async () => {
    const lit = await buildLiteral();
    const other: ScriptLiteral = {
      id: "other",
      plugin: "other",
      file: "other.inline.ts",
      code: 'function t(){document.body.dataset.theme="dark"}document.addEventListener("nav",t);',
      kind: "inline",
    };
    // Quartz joinScripts: IIFE per script, joined, minified again
    const joined = [
      `(function () {const __OPTS__ = {"x":1};\n${lit.code}})();`,
      `(function () {${other.code}})();`,
    ].join("\n");
    const served = (await transform(joined, { minify: true })).code;
    expect(served.includes(lit.code.trim())).toBe(false);
    const matches = alignJoinedScript(served, [other, lit])!;
    expect(matches).toBeDefined();
    const litMatch = matches.find((m) => m.literalId === lit.id)!;
    const servedFns = enumerateFunctions(served);
    for (const fn of enumerateFunctions(lit.code)) {
      const at = litMatch.toServed(fn.bodyStart);
      expect(servedFns.some((s) => s.bodyStart === at)).toBe(true);
    }
    // wrong candidate → no alignment
    expect(
      alignJoinedScript(served, [{ id: "x", code: "function q(a,b,c){}" }]),
    ).toBeUndefined();
  });
});

describe("analyzeCoverage", () => {
  it("merges dumps and attributes executed functions to literals", async () => {
    const lit = await buildLiteral();
    const never: ScriptLiteral = {
      id: "never:x.inline.ts",
      plugin: "never",
      file: "never/x.inline.ts",
      code: "function z(){}",
      kind: "dist-literal",
    };
    const prefix = 'window.__p="1";\n';
    const served = prefix + lit.code;
    const litFns = literalFunctions(lit);
    const closeIdx = litFns.findIndex((f) => f.name === "closePanel");
    const keyIdx = litFns.findIndex((f) => f.name === "onKeydown");
    // dump 1 runs everything but closePanel / onKeydown; dump 2 runs onKeydown
    const servedFns = enumerateFunctions(served);
    const idxInServed = (litIdx: number) =>
      servedFns.findIndex(
        (s) => s.bodyStart === prefix.length + litFns[litIdx].bodyStart,
      );
    const close = idxInServed(closeIdx);
    const key = idxInServed(keyIdx);
    const dumps: CoverageDump[] = [
      {
        test: "t1",
        file: "a.spec.ts",
        entries: [
          {
            url: "http://127.0.0.1/s.js",
            sourceHash: "h",
            functions: fakeCoverage(served, (i) => i !== close && i !== key),
          },
        ],
      },
      {
        test: "t2",
        file: "a.spec.ts",
        entries: [
          {
            url: "http://127.0.0.1/s.js",
            sourceHash: "h",
            functions: fakeCoverage(served, (i) => i === key),
          },
          {
            url: "http://127.0.0.1/other.js",
            sourceHash: "o",
            functions: fakeCoverage("function q(){}", () => false),
          },
        ],
      },
    ];
    const sources = new Map([
      ["h", served],
      ["o", "function q(){}"],
    ]);
    const literals = [lit, never];
    const matchCache = new Map<string, LiteralMatch[]>(
      [...sources].map(([h, text]) => [h, locateLiterals(text, literals)]),
    );
    const analysis = analyzeCoverage(
      literals,
      dumps,
      sources,
      (h) => matchCache.get(h) ?? [],
      (h) => (h === "o" ? "someplugin" : undefined),
    );
    const panel = analysis.literals.find((r) => r.literal.id === lit.id)!;
    expect(panel.tests).toBe(2);
    const missed = panel.functions
      .filter((f) => !f.executed)
      .map((f) => f.name);
    expect(missed).toEqual(["closePanel"]);
    expect(analysis.unattributed).toHaveLength(1);
    expect(analysis.unattributed[0].owner).toBe("someplugin");

    const summaries = summarizePlugins(analysis);
    expect(summaries[0].plugin).toBe("never");
    expect(summaries[0].neverLoaded).toEqual(["never/x.inline.ts"]);
    const p = summaries.find((s) => s.plugin === "panel")!;
    expect(p.ownFunctions).toBe(p.allFunctions - 1); // slugOf is bundled
    expect(p.ownExecuted).toBe(p.ownFunctions - 1);
  });
});

describe("discovery helpers", () => {
  it("extracts *_inline_default literals from dist bundles", () => {
    const dist =
      "var explorer_inline_default = `var z=1;\\${x}`;\nvar ttrpg_map_inline_default2 = 'function f(){}';\nvar other = 'x';";
    const lits = extractInlineLiterals(dist);
    expect([...lits.keys()]).toEqual([
      "explorer_inline_default",
      "ttrpg_map_inline_default2",
    ]);
    expect(lits.get("ttrpg_map_inline_default2")).toBe("function f(){}");
    expect(lits.get("explorer_inline_default")).toBe("var z=1;${x}");
    expect(inlineVarStem("src/scripts/ttrpg-map.inline.ts")).toBe(
      "ttrpg_map_inline_default",
    );
  });

  it("fingerprints strings, including template parts", () => {
    expect(
      stringTokens('a(`${x}-checkbox-${y}`);b("input.toggle");c("ab")'),
    ).toEqual(["-checkbox-", "input.toggle"]);
  });

  it("guesses the owner of raw scripts by shared lines", () => {
    const served =
      'document.addEventListener("nav", () => {\n  const ul = document.getElementById("explorer-list-0")\n})';
    expect(
      fingerprintOwner(served, [
        { owner: "graph", text: "nothing here" },
        {
          owner: "explorer",
          text: '  const ul = document.getElementById("explorer-list-0")\ndocument.addEventListener("nav", () => {',
        },
      ]),
    ).toBe("explorer");
    expect(
      fingerprintOwner(served, [{ owner: "graph", text: "" }]),
    ).toBeUndefined();
  });
});
