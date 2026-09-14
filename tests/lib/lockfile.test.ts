import { describe, expect, it } from "vitest";
import {
  detectNestedEcosystemDuplicates,
  requiresResolvedAndIntegrity,
  type LockfileEntry,
} from "../../scripts/lib/lockfile.js";

describe("requiresResolvedAndIntegrity", () => {
  const packages: Record<string, LockfileEntry> = {};

  it("exempts the root entry", () => {
    expect(requiresResolvedAndIntegrity("", {}, packages)).toBe(false);
  });

  it("exempts symlink entries", () => {
    expect(
      requiresResolvedAndIntegrity(
        "node_modules/pkg",
        { link: true },
        packages,
      ),
    ).toBe(false);
  });

  it("exempts bundled entries", () => {
    expect(
      requiresResolvedAndIntegrity(
        "node_modules/pkg",
        { inBundle: true },
        packages,
      ),
    ).toBe(false);
  });

  it.each([
    "git+https://example.test/repo.git",
    "git:ssh://example.test/repo.git",
    "github:a/b",
  ])("exempts git version source %s", (version) => {
    expect(
      requiresResolvedAndIntegrity("node_modules/pkg", { version }, packages),
    ).toBe(false);
  });

  it("exempts a git resolved source", () => {
    expect(
      requiresResolvedAndIntegrity(
        "node_modules/pkg",
        { resolved: "ssh://git@example.test/repo.git" },
        packages,
      ),
    ).toBe(false);
  });

  it("exempts a local directory targeted by a workspace link", () => {
    const workspacePackages = {
      "packages/pkg": { version: "1.0.0" },
      "node_modules/pkg": { link: true, resolved: "packages/pkg" },
    };
    expect(
      requiresResolvedAndIntegrity(
        "packages/pkg",
        workspacePackages["packages/pkg"],
        workspacePackages,
      ),
    ).toBe(false);
  });

  it("requires registry metadata even when version is present", () => {
    expect(
      requiresResolvedAndIntegrity(
        "node_modules/@scope/name",
        { version: "1.2.3" },
        packages,
      ),
    ).toBe(true);
  });

  it("does not exempt dev registry packages", () => {
    expect(
      requiresResolvedAndIntegrity(
        "node_modules/pkg",
        { version: "1.0.0", dev: true },
        packages,
      ),
    ).toBe(true);
  });
});

describe("detectNestedEcosystemDuplicates", () => {
  it("groups nested ecosystem entries by package with counts and versions", () => {
    const packages = {
      "node_modules/@quartz-community/types": { version: "0.3.0" },
      "node_modules/a/node_modules/@quartz-community/types": {
        version: "0.2.1",
      },
      "node_modules/b/node_modules/@quartz-community/types": {
        version: "0.2.1",
      },
      "node_modules/c/node_modules/@quartz-themes/core": { version: "1.0.0" },
      "node_modules/a/node_modules/unrelated": { version: "1.0.0" },
    };

    expect(detectNestedEcosystemDuplicates(packages)).toEqual([
      { packageName: "@quartz-community/types", count: 2, versions: ["0.2.1"] },
      { packageName: "@quartz-themes/core", count: 1, versions: ["1.0.0"] },
    ]);
  });
});
