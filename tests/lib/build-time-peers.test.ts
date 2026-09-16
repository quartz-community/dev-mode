import { describe, expect, it } from "vitest";
import { checkBuildTimePeerAvailability } from "../../scripts/lib/build-time-peers.js";

describe("checkBuildTimePeerAvailability", () => {
  it("fails when a required peer is missing from build dependencies", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { library: "^1.0.0" },
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      "@quartz-community/plugin@1.0.0 peer library ^1.0.0 is not in devDependencies; source builds will fail under legacy-peer-deps [required]",
    ]);
  });

  it("passes when a required peer is present in devDependencies", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { library: "^1.0.0" },
        devDependencies: { library: "^1.0.0" },
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
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual([]);
  });

  it("skips singleton-external vfile peers", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { vfile: "^6.0.0" },
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual([]);
  });

  it("reports a missing optional peer as a warning without failing", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { optional: "^1.0.0" },
        peerDependenciesMeta: { optional: { optional: true } },
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual([
      "warning: @quartz-community/plugin@1.0.0 peer optional ^1.0.0 is not in devDependencies; source builds will fail under legacy-peer-deps [optional]",
    ]);
  });

  it("reproduces the syntax-highlighting 1.0.0 failure", () => {
    const result = checkBuildTimePeerAvailability([
      {
        name: "@quartz-community/syntax-highlighting",
        version: "1.0.0",
        peerDependencies: { shiki: "^4.0.0" },
        peerDependenciesMeta: { shiki: { optional: false } },
      },
    ]);

    expect(result).toEqual({
      name: "Build-time peer availability",
      ok: false,
      details: [
        "@quartz-community/syntax-highlighting@1.0.0 peer shiki ^4.0.0 is not in devDependencies; source builds will fail under legacy-peer-deps [required]",
      ],
    });
  });
});
