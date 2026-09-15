import { describe, expect, it } from "vitest";
import {
  checkPeerConsistency,
  type PeerConsistencyPackage,
} from "../../scripts/lib/peer-consistency.js";

const quartz: PeerConsistencyPackage = {
  name: "@jackyzha0/quartz",
  dependencies: {
    "@quartz-community/plugin": "^1.0.0",
    dependency: "1.1.0",
  },
};

describe("checkPeerConsistency", () => {
  it("fails an incompatible optional peer", () => {
    const result = checkPeerConsistency(quartz, [
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { dependency: "^0.1.19" },
        peerDependenciesMeta: { dependency: { optional: true } },
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain("[optional]");
  });

  it("passes when Quartz does not declare the peer", () => {
    const result = checkPeerConsistency(quartz, [
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { absent: "^1.0.0" },
      },
    ]);

    expect(result).toEqual({
      name: "Third-party peer consistency",
      ok: true,
      details: [],
    });
  });

  it("passes a peer satisfied by the minimum Quartz root version", () => {
    const result = checkPeerConsistency(quartz, [
      {
        name: "@quartz-community/plugin",
        version: "1.0.0",
        peerDependencies: { dependency: "^1.0.0" },
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it("detects the created-modified-date production mismatch", () => {
    const result = checkPeerConsistency(
      {
        dependencies: {
          "@quartz-community/created-modified-date": "^1.0.0",
          "@napi-rs/simple-git": "1.1.0",
        },
      },
      [
        {
          name: "@quartz-community/created-modified-date",
          version: "1.0.0",
          peerDependencies: { "@napi-rs/simple-git": "^0.1.19" },
          peerDependenciesMeta: {
            "@napi-rs/simple-git": { optional: true },
          },
        },
      ],
    );

    expect(result).toEqual({
      name: "Third-party peer consistency",
      ok: false,
      details: [
        "@quartz-community/created-modified-date@1.0.0 peer @napi-rs/simple-git ^0.1.19 not satisfied by Quartz root 1.1.0 [optional]",
      ],
    });
  });
});
