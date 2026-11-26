import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  applyAffected,
  bundledCopiesBelow,
  changedDeclarations,
  changelogBetween,
  collectBundleModules,
  declaredInBundle,
  detectBundleMode,
  evaluateBundle,
  isFailing,
  isTracked,
  packageNameOfPath,
  parseModuleSource,
  readTarball,
  sourceIndex,
  staleLevel,
  summarize,
  topLevelDeclarations,
  trackedLockCopies,
  versionStatus,
  type BundledDep,
  type BundleLock,
  type EvaluateInput,
} from "../scripts/lib/bundled-deps/analyze.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "bundled-deps");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf-8");
const LOCK = JSON.parse(fixture("package-lock.json")) as BundleLock;

const LATEST: Record<string, string> = {
  "@quartz-community/utils": "1.3.1",
  "@quartz-community/types": "1.5.0",
  "@quartz-community/remark-obsidian": "2.2.4",
};

function input(overrides: Partial<EvaluateInput>): EvaluateInput {
  return {
    repo: "example",
    package: "@quartz-community/example",
    source: "main",
    lock: LOCK,
    modules: null,
    mode: { kind: "all", except: [], include: [] },
    tracked: (name) => isTracked(name),
    latest: (name) => LATEST[name] ?? null,
    workspace: () => null,
    ...overrides,
  };
}

describe("tracking and lockfile copies", () => {
  it("tracks ecosystem packages and --deps globs, never Quartz core", () => {
    expect(isTracked("@quartz-community/utils")).toBe(true);
    expect(isTracked("@quartz-themes/core")).toBe(true);
    expect(isTracked("@jackyzha0/quartz", ["@jackyzha0/*"])).toBe(false);
    expect(isTracked("unified")).toBe(false);
    expect(isTracked("unified", ["unif*"])).toBe(true);
  });

  it("names the package of a nested install path", () => {
    expect(packageNameOfPath("node_modules/a/node_modules/@s/b")).toBe("@s/b");
    expect(packageNameOfPath("node_modules/plain")).toBe("plain");
    expect(packageNameOfPath("packages/x")).toBeUndefined();
  });

  it("lists every copy, including nested duplicates, and skips links", () => {
    const copies = trackedLockCopies(LOCK, (name) => isTracked(name));
    expect(copies.map((c) => [c.path, c.version, c.dev])).toEqual([
      ["node_modules/@quartz-community/remark-obsidian", "2.2.1", false],
      ["node_modules/@quartz-community/types", "1.0.0", true],
      [
        "node_modules/@quartz-community/remark-obsidian/node_modules/@quartz-community/utils",
        "1.3.1",
        false,
      ],
      ["node_modules/@quartz-community/utils", "1.1.0", false],
    ]);
  });
});

describe("source maps", () => {
  it("parses published (node_modules) sources, nested and pnpm ones", () => {
    expect(
      parseModuleSource("node_modules/@quartz-community/utils/src/lang.ts"),
    ).toEqual({
      name: "@quartz-community/utils",
      installPath: "node_modules/@quartz-community/utils",
      file: "src/lang.ts",
    });
    expect(
      parseModuleSource(
        "node_modules/@quartz-community/rehype-obsidian/node_modules/hastscript/lib/index.js",
      ),
    ).toEqual({
      name: "hastscript",
      installPath:
        "node_modules/@quartz-community/rehype-obsidian/node_modules/hastscript",
      file: "lib/index.js",
    });
    expect(
      parseModuleSource("../node_modules/.pnpm/x@1.0.0/node_modules/x/index.js")
        ?.installPath,
    ).toBe("");
    expect(parseModuleSource("src/index.ts")).toBeUndefined();
  });

  it("resolves sources relative to the map and maps workspace links", () => {
    const published = collectBundleModules([
      {
        path: "dist/components/index.js.map",
        sources: [
          "../../node_modules/@quartz-community/utils/src/lang.ts",
          "../../src/components/Graph.tsx",
        ],
      },
      {
        path: "dist/index.js.map",
        sources: ["../node_modules/@quartz-community/utils/src/path.ts"],
      },
    ]);
    expect(
      [
        ...published
          .get("@quartz-community/utils")!
          .get("node_modules/@quartz-community/utils")!,
      ].sort(),
    ).toEqual(["src/lang.ts", "src/path.ts"]);

    const workspace = collectBundleModules(
      [{ path: "dist/index.js.map", sources: ["../../utils/src/lang.ts"] }],
      new Map([["../utils/", "@quartz-community/utils"]]),
    );
    expect([...workspace.get("@quartz-community/utils")!.get("")!]).toEqual([
      "src/lang.ts",
    ]);
  });
});

describe("detectBundleMode", () => {
  it("reads noExternal regexes with negative lookaheads and external lists", () => {
    const mode = detectBundleMode(fixture("tsup.all.config.txt"));
    expect(mode.kind).toBe("all");
    expect(mode.except).toEqual(
      expect.arrayContaining(["sharp", "@napi-rs/simple-git", "preact"]),
    );
  });

  it("treats a string noExternal list (or none) as dependencies external", () => {
    expect(detectBundleMode(fixture("tsup.none.config.txt"))).toEqual({
      kind: "none",
      except: [],
      include: ["mdast-util-from-markdown", "micromark-util-types"],
    });
    expect(detectBundleMode("export default {}").kind).toBe("none");
    expect(
      detectBundleMode("build({ bundle: true, external: ['obsidian'] })"),
    ).toMatchObject({ kind: "all", except: ["obsidian"] });
    expect(detectBundleMode(null).kind).toBe("unknown");
  });
});

describe("versions", () => {
  it("classifies staleness", () => {
    expect(staleLevel("1.1.0", "1.3.1")).toBe("minor");
    expect(staleLevel("1.3.0", "1.3.1")).toBe("patch");
    expect(staleLevel("1.9.0", "2.0.0")).toBe("major");
    expect(staleLevel("1.3.1", "1.3.1")).toBeUndefined();
    expect(versionStatus("1.3.1", "1.3.1").status).toBe("current");
    expect(versionStatus("1.4.0", "1.3.1").status).toBe("ahead");
    expect(versionStatus(null, "1.3.1").status).toBe("unknown");
    expect(versionStatus("1.0.0", "2.1.0")).toEqual({
      status: "stale",
      level: "major",
    });
  });
});

describe("evaluateBundle", () => {
  it("without a source map: config heuristic, dev copies are types-only", () => {
    const rows = evaluateBundle(input({}));
    const byPath = Object.fromEntries(rows.map((row) => [row.path, row]));
    expect(byPath["node_modules/@quartz-community/utils"]).toMatchObject({
      bundled: "assumed",
      status: "stale",
      level: "minor",
    });
    expect(byPath["node_modules/@quartz-community/types"]).toMatchObject({
      bundled: "no",
      status: "types-only",
    });
    expect(
      byPath[
        "node_modules/@quartz-community/remark-obsidian/node_modules/@quartz-community/utils"
      ],
    ).toMatchObject({ status: "current" });
    expect(rows.some((row) => row.dependency === "@jackyzha0/quartz")).toBe(
      false,
    );
  });

  it("marks dependencies external when the config doesn't bundle them", () => {
    const rows = evaluateBundle(
      input({ mode: { kind: "none", except: [], include: [] } }),
    );
    expect(
      rows
        .filter((row) => row.dependency === "@quartz-community/utils")
        .map((row) => row.status),
    ).toEqual(["external", "external"]);
  });

  it("with a published source map: only the bundled copy counts", () => {
    const modules = collectBundleModules([
      {
        path: "dist/index.js.map",
        sources: [
          "../node_modules/@quartz-community/remark-obsidian/node_modules/@quartz-community/utils/src/path.ts",
          "../node_modules/@quartz-community/remark-obsidian/dist/index.js",
        ],
      },
    ]);
    const rows = evaluateBundle(input({ modules, source: "npm" }));
    const utils = rows.filter(
      (row) => row.dependency === "@quartz-community/utils",
    );
    expect(utils.map((row) => [row.version, row.status])).toEqual([
      ["1.3.1", "current"],
      ["1.1.0", "not-bundled"],
    ]);
    expect(utils[0].files).toEqual(["src/path.ts"]);
    expect(
      rows.find((row) => row.dependency === "@quartz-community/types")?.status,
    ).toBe("types-only");
    expect(
      rows.find((row) => row.dependency === "@quartz-community/remark-obsidian")
        ?.status,
    ).toBe("stale");
  });

  it("by name only (workspace build): every runtime copy is bundled", () => {
    const modules = collectBundleModules(
      [{ path: "dist/index.js.map", sources: ["../../utils/src/lang.ts"] }],
      new Map([["../utils/", "@quartz-community/utils"]]),
    );
    const rows = evaluateBundle(input({ modules, modulesByNameOnly: true }));
    expect(
      rows
        .filter((row) => row.dependency === "@quartz-community/utils")
        .map((row) => [row.version, row.status, row.bundled]),
    ).toEqual([
      ["1.3.1", "current", "yes"],
      ["1.1.0", "stale", "yes"],
    ]);
    // remark-obsidian is in the lockfile but not in this bundle
    expect(
      rows.find((row) => row.dependency === "@quartz-community/remark-obsidian")
        ?.status,
    ).toBe("types-only");
  });

  it("reports a bundled package with no lockfile as unknown", () => {
    const modules = collectBundleModules([
      {
        path: "dist/index.js.map",
        sources: ["../node_modules/@quartz-community/utils/src/lang.ts"],
      },
    ]);
    const [row] = evaluateBundle(input({ modules, lock: null }));
    expect(row).toMatchObject({ status: "unknown", version: null });
  });
});

describe("affected check", () => {
  const before = `import { x } from "./x";
// a comment
export function slugifyPath(s: string) {
  return s.toLowerCase();
}

export interface Options {
  a: string;
}

export type Fn<
  T,
> = (t: T) => void;

export const helper = () => 1;
`;
  const after = `import { x } from "./x";
export function slugifyPath(s: string) {
  return s.toLowerCase().normalize("NFD");
}

export interface Options {
  a: string;
  b?: number;
}

export type Fn<
  T,
> = (t: T) => Promise<void>;

/** docs changed */
export const helper = () => 1;
export function added() {}
`;

  it("splits runtime top-level declarations, ignoring types and comments", () => {
    expect([...topLevelDeclarations(before).keys()]).toEqual([
      "slugifyPath",
      "helper",
    ]);
    expect(changedDeclarations(before, after)).toEqual(["slugifyPath"]);
  });

  it("finds declarations in an esbuild bundle (collision suffixes too)", () => {
    expect(declaredInBundle("function slugifyPath2(s) {", "slugifyPath")).toBe(
      true,
    );
    expect(declaredInBundle("var helper = () => 1;", "helper")).toBe(true);
    expect(declaredInBundle("slugifyPathX()", "slugifyPath")).toBe(false);
  });

  const row: BundledDep = {
    repo: "graph",
    package: "@quartz-community/graph",
    source: "npm",
    dependency: "@quartz-community/utils",
    path: "node_modules/@quartz-community/utils",
    version: "1.1.0",
    latest: "1.3.1",
    workspace: null,
    bundled: "yes",
    status: "stale",
    level: "minor",
    files: ["src/path.ts", "src/lang.ts"],
  };
  const lang = "export const lang = 1;\n";
  const old = new Map([
    ["src/path.ts", before],
    ["src/lang.ts", lang],
  ]);
  const next = new Map([
    ["src/path.ts", after],
    ["src/lang.ts", lang],
  ]);

  it("stale-unaffected when the changed declarations were tree-shaken away", () => {
    expect(
      applyAffected(row, old, next, "var helper = () => 1;\nvar lang = 1;"),
    ).toMatchObject({
      status: "stale-unaffected",
      changedFiles: ["src/path.ts"],
      changedSymbols: [],
    });
  });

  it("stays stale when the bundle contains a changed declaration", () => {
    expect(
      applyAffected(row, old, next, "function slugifyPath(s) {}"),
    ).toMatchObject({
      status: "stale",
      changedSymbols: ["src/path.ts#slugifyPath"],
    });
  });

  it("file level without bundle text; unknown files keep it stale", () => {
    expect(applyAffected(row, old, next).status).toBe("stale");
    expect(applyAffected(row, old, old).status).toBe("stale-unaffected");
    expect(
      applyAffected(row, new Map([["src/path.ts", before]]), old),
    ).toMatchObject({ status: "stale", note: expect.stringContaining("1") });
    expect(applyAffected({ ...row, files: undefined }, old, next).status).toBe(
      "stale",
    );
  });
});

describe("changelogBetween", () => {
  it("lists versions in (from, to] with first bullet lines", () => {
    expect(changelogBetween(fixture("CHANGELOG.md"), "1.2.0", "1.3.1")).toEqual(
      [
        {
          version: "1.3.1",
          lines: ["`stripDiacritics` keeps slugs free of percent-encoding."],
        },
        {
          version: "1.3.0",
          lines: [
            "Add `setSlugOptions({ stripDiacritics })`.",
            "Second change.",
          ],
        },
        {
          version: "1.2.1",
          lines: ["`unescapeHTML` decodes each entity once."],
        },
      ],
    );
    expect(changelogBetween(fixture("CHANGELOG.md"), "1.3.1", "1.3.1")).toEqual(
      [],
    );
  });
});

function tarEntry(name: string, content: string, type = "0"): Buffer {
  const data = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0);
  header.write("0000644\0", 100);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write(type, 156);
  header.write("ustar\0", 257);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header, padded]);
}

describe("readTarball + sourceIndex", () => {
  it("reads regular files (pax long names too) and indexes map sources", () => {
    const longName = `package/dist/${"x".repeat(120)}.js`;
    const body = ` path=${longName}\n`;
    const pax = `${body.length + String(body.length + 3).length}${body}`;
    const map = JSON.stringify({
      sources: ["../src/lang.ts"],
      sourcesContent: ["export const lang = 1;\n"],
    });
    const tgz = gzipSync(
      Buffer.concat([
        tarEntry("package/package.json", '{"name":"x"}'),
        tarEntry("package/dist/lang.js.map", map),
        tarEntry("PaxHeader", pax, "x"),
        tarEntry("ignored-short-name", "long"),
        tarEntry("package/../evil.js", "nope"),
        Buffer.alloc(1024),
      ]),
    );
    const files = readTarball(tgz);
    expect([...files.keys()]).toEqual([
      "package.json",
      "dist/lang.js.map",
      `dist/${"x".repeat(120)}.js`,
    ]);
    const index = sourceIndex(files);
    expect(index.get("src/lang.ts")).toBe("export const lang = 1;\n");
    expect(index.get("package.json")).toBe('{"name":"x"}');
  });
});

describe("summary and release checks", () => {
  it("fails on stale; any also counts stale-unaffected", () => {
    const rows = evaluateBundle(input({}));
    const counts = summarize(rows);
    expect(counts.stale).toBe(2);
    expect(counts["types-only"]).toBe(1);
    const unaffected = { ...rows[0], status: "stale-unaffected" as const };
    expect(isFailing(unaffected, "stale")).toBe(false);
    expect(isFailing(unaffected, "any")).toBe(true);
  });

  it("bundledCopiesBelow ignores dev, external and up-to-date copies", () => {
    const all = { kind: "all" as const, except: [], include: [] };
    expect(
      bundledCopiesBelow(LOCK, all, "@quartz-community/utils", "1.3.1").map(
        (copy) => copy.version,
      ),
    ).toEqual(["1.1.0"]);
    expect(
      bundledCopiesBelow(LOCK, all, "@quartz-community/types", "1.5.0"),
    ).toEqual([]);
    expect(
      bundledCopiesBelow(
        LOCK,
        { kind: "none", except: [], include: [] },
        "@quartz-community/utils",
        "2.0.0",
      ),
    ).toEqual([]);
  });
});
