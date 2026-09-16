import { describe, expect, it } from "vitest";
import {
  checkBuildTimePeerAvailability,
  collectModuleSpecifiers,
} from "../../scripts/lib/build-time-peers.js";

describe("collectModuleSpecifiers", () => {
  it("detects imports, side-effect imports, exports, and require calls", () => {
    expect(
      collectModuleSpecifiers([
        `import value from "imported";
         import "side-effect";
         export { value } from "exported/subpath";
         const required = require("required");`,
      ]),
    ).toEqual(
      new Set(["imported", "side-effect", "exported/subpath", "required"]),
    );
  });
});

describe("checkBuildTimePeerAvailability", () => {
  it("fails when an imported required peer is missing from build dependencies", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { library: "^1.0.0" },
        sourceFiles: [`import { value } from "library";`],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      "@quartz-community/plugin@1.0.0 peer library ^1.0.0 is imported by src/ but missing from devDependencies; source builds fail under legacy-peer-deps [required]",
    ]);
  });

  it("warns without failing when an imported optional peer is missing", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { library: "^1.0.0" },
        peerDependenciesMeta: { library: { optional: true } },
        sourceFiles: [`const library = require("library");`],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual([
      "warning: @quartz-community/plugin@1.0.0 peer library ^1.0.0 is imported by src/ but missing from devDependencies; source builds fail under legacy-peer-deps [optional]",
    ]);
  });

  it("warns without failing when a required peer is not imported", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-themes/core",
        version: "2.0.0",
        peerDependencies: { preact: "^10.0.0" },
        sourceFiles: [`export const theme = "default";`],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual([
      "warning: @quartz-themes/core@2.0.0 peer preact ^10.0.0 is declared but not imported by src/ and missing from devDependencies [required]",
    ]);
  });

  it("counts a subpath import as importing its peer package", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { preact: "^10.0.0" },
        sourceFiles: [`export { jsx } from "preact/jsx-runtime";`],
      },
    ]);

    expect(result.ok).toBe(false);
  });

  it("produces no finding when the peer is present in devDependencies", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { library: "^1.0.0" },
        devDependencies: { library: "^1.0.0" },
        sourceFiles: [`import { value } from "library";`],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual([]);
  });

  it("skips ecosystem peers", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { "@quartz-community/types": "^1.0.0" },
        sourceFiles: [
          `import type { QuartzPlugin } from "@quartz-community/types";`,
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual([]);
  });

  it("reproduces the exact utils 1.0.0 preact failure", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/utils",
        version: "1.0.0",
        peerDependencies: { preact: "^10.0.0" },
        sourceFiles: [
          `import type { JSXInternal } from "preact/src/jsx";
           import { jsx } from "preact/jsx-runtime";`,
        ],
      },
    ]);

    expect(result).toEqual({
      name: "Build-time peer availability",
      ok: false,
      details: [
        "@quartz-community/utils@1.0.0 peer preact ^10.0.0 is imported by src/ but missing from devDependencies; source builds fail under legacy-peer-deps [required]",
      ],
    });
  });
});
