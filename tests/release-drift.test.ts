import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectDrift,
  compareRepoDrift,
  driftLevel,
  groupDrift,
  matchesIgnore,
  normalizePnpmVersion,
  npmLockVersion,
  type DriftEntry,
} from "../scripts/lib/release/drift.js";

describe("normalizePnpmVersion", () => {
  it.each([
    ["1.70.0", "1.70.0"],
    ["8.5.1(jiti@2.7.0)(typescript@5.9.3)", "8.5.1"],
    ["string-width@4.2.3", "4.2.3"],
    ["@scope/pkg@2.0.0(react@19.0.0)", "2.0.0"],
    ["1.0.0-beta.1", "1.0.0-beta.1"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizePnpmVersion(raw)).toBe(expected);
  });

  it.each(["link:../types", "file:../x", undefined, "not-a-version"])(
    "ignores %s",
    (raw) => {
      expect(normalizePnpmVersion(raw)).toBeUndefined();
    },
  );
});

describe("npmLockVersion", () => {
  it("reads v2/v3 packages and v1 dependencies, skipping links", () => {
    expect(
      npmLockVersion(
        { packages: { "node_modules/a": { version: "1.2.3" } } },
        "a",
      ),
    ).toBe("1.2.3");
    expect(
      npmLockVersion({ dependencies: { a: { version: "1.0.0" } } }, "a"),
    ).toBe("1.0.0");
    expect(
      npmLockVersion(
        { packages: { "node_modules/a": { link: true, version: "1.0.0" } } },
        "a",
      ),
    ).toBeUndefined();
    expect(npmLockVersion({}, "a")).toBeUndefined();
  });
});

describe("driftLevel", () => {
  it("only cares about major/minor", () => {
    expect(driftLevel("1.26.0", "1.70.0")).toBe("minor");
    expect(driftLevel("1.2.3", "2.0.0")).toBe("major");
    expect(driftLevel("1.2.3", "1.2.9")).toBeUndefined();
  });
});

describe("compareRepoDrift", () => {
  it("flags the themes-core lucide case and ignores linked ecosystem packages", () => {
    const result = compareRepoDrift(
      "quartz-themes-core",
      {
        name: "@quartz-themes/core",
        dependencies: {
          "@quartz-community/types": "^1.0.0",
          preact: "^10.0.0",
        },
        devDependencies: { "@lucide/icons": "^1.7.0", typescript: "^5.9.3" },
      },
      {
        packages: {
          "node_modules/@quartz-community/types": { version: "0.1.0" },
          "node_modules/preact": { version: "10.29.1" },
          "node_modules/@lucide/icons": { version: "1.26.0" },
          "node_modules/typescript": { version: "5.9.3" },
        },
      },
      {
        dependencies: {
          "@quartz-community/types": {
            specifier: "workspace:*",
            version: "link:../types",
          },
          preact: {
            specifier: "^10.0.0",
            version: "10.29.8(preact-render-to-string@6.8.2)",
          },
        },
        devDependencies: {
          "@lucide/icons": { specifier: "^1.7.0", version: "1.70.0" },
          typescript: { specifier: "^5.9.3", version: "5.9.3" },
        },
      },
    );
    expect(result.compared).toBe(3);
    expect(result.drift).toEqual([
      {
        repo: "quartz-themes-core",
        dependency: "@lucide/icons",
        field: "devDependencies",
        specifier: "^1.7.0",
        lockfile: "1.26.0",
        workspace: "1.70.0",
        level: "minor",
        newer: "workspace",
      },
    ]);
  });

  it("finds a peer that pnpm lists under devDependencies, once", () => {
    const result = compareRepoDrift(
      "x",
      {
        peerDependencies: { preact: "^10" },
        devDependencies: { preact: "^10.20.0" },
      },
      { packages: { "node_modules/preact": { version: "11.0.0" } } },
      { devDependencies: { preact: { version: "10.29.8" } } },
    );
    expect(result.compared).toBe(1);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      level: "major",
      newer: "lockfile",
    });
  });

  it("skips deps missing on either side", () => {
    const result = compareRepoDrift(
      "x",
      { dependencies: { a: "^1", b: "^1" } },
      { packages: { "node_modules/a": { version: "1.0.0" } } },
      { dependencies: { b: { version: "1.5.0" } } },
    );
    expect(result).toEqual({ repo: "x", compared: 0, drift: [] });
  });
});

describe("collectDrift", () => {
  it("skips repos without a lockfile and non-workspace (standalone) repos", () => {
    const root = mkdtempSync(join(tmpdir(), "drift-"));
    const make = (name: string, lock: boolean) => {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name, dependencies: { a: "^1.0.0" } }),
      );
      if (lock)
        writeFileSync(
          join(dir, "package-lock.json"),
          JSON.stringify({
            packages: { "node_modules/a": { version: "1.0.0" } },
          }),
        );
      return { repo: name, path: dir };
    };
    const results = collectDrift(
      [make("nolock", false), make("tui", true), make("graph", true)],
      {
        importers: {
          "repos/graph": { dependencies: { a: { version: "1.3.0" } } },
        },
      },
    );
    expect(results.map((r) => [r.repo, r.skipped ?? r.drift.length])).toEqual([
      ["nolock", "no package-lock.json"],
      ["tui", expect.stringContaining("not a pnpm workspace member")],
      ["graph", 1],
    ]);
  });
});

describe("groupDrift / matchesIgnore", () => {
  const entry = (
    repo: string,
    dependency: string,
    lockfile: string,
    workspace: string,
    level: "major" | "minor" = "minor",
  ): DriftEntry => ({
    repo,
    dependency,
    field: "devDependencies",
    specifier: "^1",
    lockfile,
    workspace,
    level,
    newer: "workspace",
  });

  it("groups per dependency, majors first, then isolated before widespread", () => {
    const groups = groupDrift([
      entry("a", "@types/node", "24.13.3", "24.19.2"),
      entry("b", "@types/node", "24.10.0", "24.19.2"),
      entry("c", "@types/node", "24.13.3", "24.19.2"),
      entry("themes", "@lucide/icons", "1.26.0", "1.70.0"),
      entry("syncer", "globals", "14.0.0", "17.14.0", "major"),
    ]);
    expect(groups.map((g) => g.dependency)).toEqual([
      "globals",
      "@lucide/icons",
      "@types/node",
    ]);
    expect(groups[2]).toMatchObject({
      lockfileVersions: ["24.10.0", "24.13.3"],
      workspaceVersions: ["24.19.2"],
      repos: ["a", "b", "c"],
    });
  });

  it("matches simple globs", () => {
    expect(matchesIgnore("@types/node", ["@types/*"])).toBe(true);
    expect(matchesIgnore("sass-embedded", ["sass*"])).toBe(true);
    expect(matchesIgnore("sass", ["sass-*"])).toBe(false);
    expect(matchesIgnore("x.y", ["x?y"])).toBe(false);
  });
});
