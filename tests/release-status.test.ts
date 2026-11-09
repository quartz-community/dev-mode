import { describe, expect, it } from "vitest";
import {
  classifyStatus,
  isReleasablePath,
  packageJsonReleasableChanges,
  type ClassifyInput,
} from "../scripts/lib/release/classify.js";
import { parsePackageSpec } from "../scripts/lib/release/npm.js";
import { staleLockEntriesFrom } from "../scripts/lib/release/status.js";
import { githubRepoFrom } from "../scripts/lib/release/workspace.js";

describe("isReleasablePath", () => {
  it.each([
    "src/index.ts",
    "src/components/Graph.tsx",
    "tsup.config.ts",
    "tsconfig.build.json",
    "types/globals.d.ts",
    "package.json",
  ])("treats %s as releasable", (path) => {
    expect(isReleasablePath(path)).toBe(true);
  });

  it.each([
    "test/graph.test.ts",
    "tests/fixtures/a.md",
    "src/foo.test.ts",
    "src/__tests__/x.ts",
    "README.md",
    "CHANGELOG.md",
    "docs/usage.md",
    ".github/workflows/ci.yml",
    ".changeset/cool-change.md",
    ".gitignore",
    ".prettierrc",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.ts",
    "vitest.integration.config.ts",
    "eslint.config.mts",
    "quartz/.quartz-cache/fonts/Body+Font-400",
    "dist/index.js",
  ])("treats %s as not releasable", (path) => {
    expect(isReleasablePath(path)).toBe(false);
  });
});

describe("packageJsonReleasableChanges", () => {
  it("ignores version, scripts and devDependencies", () => {
    expect(
      packageJsonReleasableChanges(
        { version: "1.0.0", scripts: { a: "x" }, devDependencies: { v: "1" } },
        { version: "1.0.1", scripts: { a: "y" }, devDependencies: { v: "2" } },
      ),
    ).toEqual([]);
  });

  it("detects dependency and exports changes regardless of key order", () => {
    expect(
      packageJsonReleasableChanges(
        { dependencies: { a: "^1", b: "^2" }, exports: { ".": "./a.js" } },
        { dependencies: { b: "^2", a: "^1" }, exports: { ".": "./b.js" } },
      ),
    ).toEqual(["exports"]);
    expect(
      packageJsonReleasableChanges(undefined, {
        peerDependencies: { p: "^1" },
      }),
    ).toEqual(["peerDependencies"]);
  });
});

function input(overrides: Partial<ClassifyInput>): ClassifyInput {
  return {
    kind: "changesets",
    localVersion: "1.0.0",
    npmLatest: "1.0.0",
    versionTagExists: true,
    dirtyReleasableFiles: [],
    releasableCommitCount: 0,
    pendingChangesetCount: 0,
    unpushedCount: 0,
    ...overrides,
  };
}

describe("classifyStatus", () => {
  it("clean when in sync and nothing changed", () => {
    expect(classifyStatus(input({})).status).toBe("clean");
  });

  it("npm-ahead wins over everything else", () => {
    expect(
      classifyStatus(
        input({ npmLatest: "2.0.0", dirtyReleasableFiles: ["src/a.ts"] }),
      ).status,
    ).toBe("npm-ahead");
  });

  it("dirty when source files are uncommitted", () => {
    expect(
      classifyStatus(input({ dirtyReleasableFiles: ["src/a.ts"] })).status,
    ).toBe("dirty");
  });

  it("version-bumped-unpublished when local > npm or never published", () => {
    expect(classifyStatus(input({ localVersion: "1.1.0" })).status).toBe(
      "version-bumped-unpublished",
    );
    expect(classifyStatus(input({ npmLatest: null })).status).toBe(
      "version-bumped-unpublished",
    );
  });

  it("offline: falls back to the version tag", () => {
    expect(
      classifyStatus(input({ npmLatest: undefined, versionTagExists: false }))
        .status,
    ).toBe("version-bumped-unpublished");
    expect(
      classifyStatus(input({ npmLatest: undefined, versionTagExists: true }))
        .status,
    ).toBe("clean");
  });

  it("ready with a pending changeset; next step depends on push state", () => {
    const unpushed = classifyStatus(
      input({ pendingChangesetCount: 1, unpushedCount: 1 }),
    );
    expect(unpushed.status).toBe("ready");
    expect(unpushed.next).toMatch(/push/);
    const pushed = classifyStatus(
      input({ pendingChangesetCount: 1, unpushedCount: 0 }),
    );
    expect(pushed.next).toMatch(/merge/);
  });

  it("needs-changeset vs needs-version-bump by release kind", () => {
    expect(classifyStatus(input({ releasableCommitCount: 2 })).status).toBe(
      "needs-changeset",
    );
    expect(
      classifyStatus(input({ kind: "tag", releasableCommitCount: 2 })).status,
    ).toBe("needs-version-bump");
    expect(
      classifyStatus(
        input({
          kind: "github-release",
          npmLatest: undefined,
          releasableCommitCount: 1,
        }),
      ).status,
    ).toBe("needs-version-bump");
  });

  it("private packages (Quartz core) release via changesets + tags, not npm", () => {
    expect(classifyStatus(input({ kind: "private" })).status).toBe("clean");
    expect(
      classifyStatus(input({ kind: "private", releasableCommitCount: 9 }))
        .status,
    ).toBe("needs-changeset");
    expect(
      classifyStatus(
        input({
          kind: "private",
          releasableCommitCount: 9,
          pendingChangesetCount: 2,
        }),
      ).status,
    ).toBe("ready");
    expect(
      classifyStatus(
        input({ kind: "private", staleLockEntries: ["a 1.0.0 -> 1.1.0"] }),
      ).status,
    ).toBe("lockfile-stale");
  });
});

describe("staleLockEntriesFrom", () => {
  it("reports in-range updates and notes new majors", () => {
    const lock = {
      packages: {
        "node_modules/a": { version: "1.0.0" },
        "node_modules/b": { version: "1.0.0" },
        "node_modules/c": { version: "1.2.0" },
      },
    };
    const npm = new Map([
      ["a", { latest: "1.2.0", versions: ["1.0.0", "1.2.0"] }],
      ["b", { latest: "2.0.0", versions: ["1.0.0", "1.1.0", "2.0.0"] }],
      ["c", { latest: "1.2.0", versions: ["1.2.0"] }],
      ["d", { latest: "1.0.0", versions: ["1.0.0"] }],
    ]);
    expect(staleLockEntriesFrom(lock, npm)).toEqual([
      "a 1.0.0 -> 1.2.0",
      "b 1.0.0 -> 1.1.0 (npm latest 2.0.0: new major, needs a range change)",
    ]);
  });
});

describe("small parsers", () => {
  it("parsePackageSpec handles scoped names", () => {
    expect(parsePackageSpec("@quartz-community/utils@1.2.3")).toEqual({
      name: "@quartz-community/utils",
      version: "1.2.3",
    });
    expect(parsePackageSpec("pkg@1.0.0")).toEqual({
      name: "pkg",
      version: "1.0.0",
    });
    expect(() => parsePackageSpec("@scope/pkg")).toThrow();
    expect(() => parsePackageSpec("pkg@")).toThrow();
  });

  it("githubRepoFrom understands common repository forms", () => {
    expect(
      githubRepoFrom({
        repository: { url: "https://github.com/quartz-community/graph" },
      }),
    ).toBe("quartz-community/graph");
    expect(
      githubRepoFrom({ repository: "git+https://github.com/a/b.git" }),
    ).toBe("a/b");
    expect(githubRepoFrom({ repository: "github:a/b" })).toBe("a/b");
    expect(githubRepoFrom({})).toBeUndefined();
  });
});
