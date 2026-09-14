import { describe, expect, it } from "vitest";
import {
  analyzeLockfile,
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

describe("analyzeLockfile severity", () => {
  const registryMetadata = {
    resolved: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
    integrity: "sha512-test",
  };

  it("passes advisory-only duplicates in integrity-only mode but fails by default", () => {
    const lockfile = {
      packages: {
        "node_modules/a/node_modules/@quartz-community/types": {
          version: "0.2.1",
          ...registryMetadata,
        },
      },
    };

    const defaultResult = analyzeLockfile(lockfile);
    const integrityOnlyResult = analyzeLockfile(lockfile, true);

    expect(defaultResult.ok).toBe(false);
    expect(integrityOnlyResult.ok).toBe(true);
    expect(integrityOnlyResult.details).toEqual([
      "nested duplicate @quartz-community/types: 1 entries, versions 0.2.1 (advisory: reachability, not blocking)",
    ]);
  });

  it("fails blocking corruption in both modes", () => {
    const lockfile = {
      packages: {
        "node_modules/@quartz-community/types": { version: "0.2.1" },
      },
    };

    expect(analyzeLockfile(lockfile).ok).toBe(false);
    expect(analyzeLockfile(lockfile, true).ok).toBe(false);
  });

  it("fails extraneous entries in both modes", () => {
    const lockfile = {
      packages: {
        "node_modules/pkg": { ...registryMetadata, extraneous: true },
      },
    };

    expect(analyzeLockfile(lockfile).ok).toBe(false);
    expect(analyzeLockfile(lockfile, true).ok).toBe(false);
  });
});
