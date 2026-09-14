import { describe, expect, it } from "vitest";
import {
  computeReleaseWaves,
  ReleaseCycleError,
  rewriteInternalRanges,
} from "../../scripts/lib/migrate-v1.js";

describe("computeReleaseWaves", () => {
  it("groups packages after all internal dependencies", () => {
    const graph = new Map<string, ReadonlySet<string>>([
      ["@quartz-community/types", new Set()],
      ["@quartz-community/utils", new Set(["@quartz-community/types"])],
      [
        "@quartz-community/search",
        new Set(["@quartz-community/types", "@quartz-community/utils"]),
      ],
      ["@quartz-community/standalone", new Set()],
    ]);

    expect(computeReleaseWaves(graph)).toEqual([
      ["@quartz-community/standalone", "@quartz-community/types"],
      ["@quartz-community/utils"],
      ["@quartz-community/search"],
    ]);
  });

  it("reports the exact strongly-connected component", () => {
    const graph = new Map<string, ReadonlySet<string>>([
      ["@quartz-community/a", new Set(["@quartz-community/b"])],
      ["@quartz-community/b", new Set(["@quartz-community/c"])],
      ["@quartz-community/c", new Set(["@quartz-community/a"])],
      ["@quartz-community/unrelated", new Set()],
    ]);

    expect(() => computeReleaseWaves(graph)).toThrowError(
      new ReleaseCycleError([
        "@quartz-community/a",
        "@quartz-community/b",
        "@quartz-community/c",
      ]),
    );
  });
});

describe("rewriteInternalRanges", () => {
  it("rewrites only quartz-community ranges in every dependency section", () => {
    const original = {
      name: "@quartz-community/example",
      dependencies: {
        "@quartz-community/types": "^0.3.0",
        "@jackyzha0/quartz": "^5.0.0",
      },
      devDependencies: { "@quartz-community/utils": "workspace:*" },
      peerDependencies: {
        "@quartz-community/runtime": ">=0.1.0",
        "@quartz-themes/core": "^1.1.0",
      },
      optionalDependencies: {
        "@quartz-community/search": "0.1.0",
        semver: "^7.8.5",
      },
    };

    const result = rewriteInternalRanges(original);

    expect(result.packageJson).toEqual({
      ...original,
      dependencies: {
        "@quartz-community/types": "^1.0.0",
        "@jackyzha0/quartz": "^5.0.0",
      },
      devDependencies: { "@quartz-community/utils": "^1.0.0" },
      peerDependencies: {
        "@quartz-community/runtime": "^1.0.0",
        "@quartz-themes/core": "^1.1.0",
      },
      optionalDependencies: {
        "@quartz-community/search": "^1.0.0",
        semver: "^7.8.5",
      },
    });
    expect(result.rewrites).toHaveLength(4);
    expect(original.dependencies["@quartz-community/types"]).toBe("^0.3.0");
  });

  it("does not report ranges that are already migrated", () => {
    const result = rewriteInternalRanges({
      dependencies: { "@quartz-community/types": "^1.0.0" },
    });

    expect(result.rewrites).toEqual([]);
  });
});
