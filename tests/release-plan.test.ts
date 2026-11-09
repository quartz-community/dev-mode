import { describe, expect, it } from "vitest";
import {
  computeReleasePlan,
  DependencyCycleError,
  topoSort,
  type WorkspacePackage,
} from "../scripts/lib/release/graph.js";
import { buildReleaseSteps } from "../scripts/lib/release/steps.js";
import {
  formatCheckScript,
  parseTurboSummary,
  transitiveDependents,
  verdictsByPackage,
} from "../scripts/lib/release/verify.js";

function pkg(
  repo: string,
  overrides: Partial<WorkspacePackage> = {},
): WorkspacePackage {
  return {
    repo,
    name: `@quartz-community/${repo}`,
    version: "1.0.0",
    category: "plugins",
    kind: "changesets",
    githubRepo: `quartz-community/${repo}`,
    dependencies: {},
    peerDependencies: {},
    optionalDependencies: {},
    devDependencies: {},
    ...overrides,
  };
}

const T = "@quartz-community/types";
const U = "@quartz-community/utils";

/** types <- utils <- graph, types <- cname, quartz consumes graph + cname. */
function workspace(): WorkspacePackage[] {
  return [
    pkg("types", { category: "infrastructure" }),
    pkg("utils", {
      category: "infrastructure",
      version: "1.0.1",
      dependencies: { [T]: "^1.0.0" },
    }),
    pkg("graph", { dependencies: { [T]: "^1.0.0", [U]: "^1.0.0" } }),
    pkg("cname", { dependencies: { [T]: "^1.0.0" } }),
    pkg("quartz", {
      name: "@jackyzha0/quartz",
      version: "5.0.0",
      category: "core",
      kind: "private",
      dependencies: {
        "@quartz-community/graph": "^1.0.0",
        "@quartz-community/cname": "^1.0.0",
      },
      devDependencies: { [T]: "^1.0.0" },
    }),
  ];
}

describe("topoSort", () => {
  it("orders dependencies first and assigns waves", () => {
    const { order, waves } = topoSort(workspace(), [
      "@jackyzha0/quartz",
      "@quartz-community/graph",
      U,
      T,
      "@quartz-community/cname",
    ]);
    expect(order).toEqual([
      T,
      U,
      "@quartz-community/cname",
      "@quartz-community/graph",
      "@jackyzha0/quartz",
    ]);
    expect(waves.get(T)).toBe(0);
    expect(waves.get(U)).toBe(1);
    expect(waves.get("@quartz-community/cname")).toBe(1);
    expect(waves.get("@quartz-community/graph")).toBe(2);
    expect(waves.get("@jackyzha0/quartz")).toBe(3);
  });

  it("breaks ties by category tier, then name", () => {
    const packages = [
      pkg("zeta-plugin"),
      pkg("alpha-plugin"),
      pkg("infra", { category: "infrastructure" }),
    ];
    expect(
      topoSort(
        packages,
        packages.map((p) => p.name),
      ).order,
    ).toEqual([
      "@quartz-community/infra",
      "@quartz-community/alpha-plugin",
      "@quartz-community/zeta-plugin",
    ]);
  });

  it("detects cycles", () => {
    const packages = [
      pkg("a", { dependencies: { "@quartz-community/b": "^1.0.0" } }),
      pkg("b", { devDependencies: { "@quartz-community/a": "^1.0.0" } }),
    ];
    expect(() =>
      topoSort(
        packages,
        packages.map((p) => p.name),
      ),
    ).toThrow(DependencyCycleError);
  });
});

describe("computeReleasePlan", () => {
  it("a minor in-range release only affects dependents (no extra releases)", () => {
    const plan = computeReleasePlan(workspace(), [
      { query: "utils", bump: "minor" },
    ]);
    expect(plan.releases.map((r) => [r.repo, r.from, r.to, r.bump])).toEqual([
      ["utils", "1.0.1", "1.1.0", "minor"],
    ]);
    expect(plan.affected.map((a) => a.repo)).toEqual(["graph"]);
    expect(plan.lockfileUpdate).toBe(true);
    expect(plan.consumerUpdates).toEqual([]);
  });

  it("a major forces out-of-range dependents to release, transitively and in order", () => {
    const plan = computeReleasePlan(workspace(), [
      { query: "types", bump: "major" },
    ]);
    expect(plan.releases.map((r) => [r.repo, r.to, r.bump, r.wave])).toEqual([
      ["types", "2.0.0", "major", 0],
      ["utils", "1.0.2", "patch", 1],
      ["cname", "1.0.1", "patch", 1],
      ["graph", "1.0.1", "patch", 2],
    ]);
    const graph = plan.releases.find((r) => r.repo === "graph")!;
    expect(graph.reasons).toEqual(["dependency-out-of-range"]);
    expect(graph.rangeUpdates).toEqual([
      { dependency: T, kind: "dependencies", from: "^1.0.0", to: "^2.0.0" },
    ]);
    // utils@1.0.2 is still in graph's ^1.0.0 range — no utils range edit needed.
    expect(graph.triggeredBy).toEqual([T]);
    // Quartz is private: it only gets a devDependency advisory and a lockfile refresh.
    expect(
      plan.advisories.some((a) => a.includes("devDependency") && a.includes(T)),
    ).toBe(true);
    expect(plan.advisories.some((a) => a.includes("goes major"))).toBe(true);
  });

  it("a peer dependency moving to a new major makes the dependent major too", () => {
    const packages = [
      pkg("core-lib", { category: "infrastructure" }),
      pkg("plugin", {
        peerDependencies: { "@quartz-community/core-lib": "^1.0.0" },
      }),
      pkg("site", {
        kind: "private",
        category: "core",
        dependencies: { "@quartz-community/plugin": "^1.0.0" },
      }),
    ];
    const plan = computeReleasePlan(packages, [
      { query: "core-lib", bump: "major" },
    ]);
    expect(plan.releases.map((r) => [r.repo, r.to])).toEqual([
      ["core-lib", "2.0.0"],
      ["plugin", "2.0.0"],
    ]);
    // The private consumer needs its own range edit for the plugin's new major.
    expect(plan.consumerUpdates).toEqual([
      {
        repo: "site",
        name: "@quartz-community/site",
        rangeUpdates: [
          {
            dependency: "@quartz-community/plugin",
            kind: "dependencies",
            from: "^1.0.0",
            to: "^2.0.0",
          },
        ],
      },
    ]);
  });

  it("uses pending changesets when no --bump is given, and keeps the larger one", () => {
    const packages = workspace();
    packages.find((p) => p.repo === "graph")!.pendingBump = "minor";
    expect(
      computeReleasePlan(packages, [{ query: "graph" }]).releases[0].to,
    ).toBe("1.1.0");
    const plan = computeReleasePlan(packages, [
      { query: "graph", bump: "patch" },
    ]);
    expect(plan.releases[0].bump).toBe("minor");
    expect(plan.advisories.some((a) => a.includes("pending changeset"))).toBe(
      true,
    );
  });

  it("defaults to patch and accepts npm names", () => {
    const plan = computeReleasePlan(workspace(), [
      { query: "@quartz-community/cname" },
    ]);
    expect(plan.releases.map((r) => [r.repo, r.to])).toEqual([
      ["cname", "1.0.1"],
    ]);
  });

  it("suggests raising the minimum when a requested dependent rides along a minor", () => {
    const plan = computeReleasePlan(workspace(), [
      { query: "utils", bump: "minor" },
      { query: "graph" },
    ]);
    const graph = plan.releases.find((r) => r.repo === "graph")!;
    expect(graph.rangeUpdates).toEqual([]);
    expect(graph.suggestedRangeUpdates).toEqual([
      { dependency: U, kind: "dependencies", from: "^1.0.0", to: "^1.1.0" },
    ]);
    expect(plan.releases.map((r) => r.repo)).toEqual(["utils", "graph"]);
  });

  it("publishes an already-bumped, unpublished version as-is", () => {
    const packages = workspace();
    packages.find((p) => p.repo === "utils")!.unpublishedVersion = true;
    const plan = computeReleasePlan(packages, [
      { query: "utils", bump: "major" },
    ]);
    expect(plan.releases[0]).toMatchObject({
      repo: "utils",
      from: "1.0.1",
      to: "1.0.1",
      bump: null,
    });
    expect(plan.advisories[0]).toMatch(/already bumped/);
  });

  it("rejects unknown and private packages", () => {
    expect(() => computeReleasePlan(workspace(), [{ query: "nope" }])).toThrow(
      /unknown/,
    );
    expect(() =>
      computeReleasePlan(workspace(), [{ query: "quartz" }]),
    ).toThrow(/private/);
  });

  it("flags pre-existing ranges that exclude the workspace version", () => {
    const packages = [
      pkg("remark", { version: "1.1.0", category: "infrastructure" }),
      pkg("tool", {
        kind: "github-release",
        category: "tools",
        dependencies: { "@quartz-community/remark": "^0.2.2" },
      }),
    ];
    const plan = computeReleasePlan(packages, [{ query: "remark" }]);
    // 1.1.1 is outside ^0.2.2, so the tool must take a range bump + release.
    expect(plan.releases.map((r) => r.repo)).toEqual(["remark", "tool"]);
    expect(plan.releases[1].rangeUpdates[0].to).toBe("^1.1.1");
    expect(plan.advisories.some((a) => a.includes("GitHub releases"))).toBe(
      true,
    );
  });
});

describe("buildReleaseSteps", () => {
  it("marks push/merge/tag steps outward-facing and ends with the Quartz lockfile", () => {
    const plan = computeReleasePlan(workspace(), [
      { query: "types", bump: "major" },
    ]);
    const steps = buildReleaseSteps(plan);
    expect(steps[0].command).toMatch(
      /release\.ts verify types utils cname graph$/,
    );
    for (const step of steps) {
      const outwardCommand =
        /push-repo|gh pr merge|publish-tag|push origin/.test(step.command);
      expect(step.kind === "outward").toBe(outwardCommand);
      expect(step.requiresHuman).toBe(step.kind === "outward");
    }
    expect(steps.at(-2)!.command).toBe("just update-quartz-lockfile");
    expect(steps.at(-1)).toMatchObject({
      command: "just push-repo quartz",
      kind: "outward",
    });
    // A dependent's lockfile regen comes after its dependency's wait-npm.
    const waitTypes = steps.findIndex((s) =>
      s.command.includes("wait-npm @quartz-community/types@2.0.0"),
    );
    const regenGraph = steps.findIndex(
      (s) => s.command === "just regen-lockfile graph",
    );
    expect(waitTypes).toBeGreaterThan(0);
    expect(regenGraph).toBeGreaterThan(waitTypes);
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i + 1));
  });

  it("does not re-add a changeset when one is pending and no range edit is needed", () => {
    const packages = workspace();
    packages.find((p) => p.repo === "cname")!.pendingBump = "patch";
    const steps = buildReleaseSteps(
      computeReleasePlan(packages, [{ query: "cname" }]),
    );
    expect(steps.some((s) => s.command.includes(" changeset "))).toBe(false);
    expect(steps.some((s) => s.command === "just push-repo cname")).toBe(true);
  });

  it("uses publish-tag for tag-released repos", () => {
    const packages = [pkg("themes", { kind: "tag", category: "themes" })];
    const steps = buildReleaseSteps(
      computeReleasePlan(packages, [{ query: "themes", bump: "minor" }]),
    );
    expect(steps.map((s) => s.command)).toContain(
      "(cd repos/themes && npm version minor --no-git-tag-version)",
    );
    expect(
      steps.find((s) => s.command === "just publish-tag themes")?.kind,
    ).toBe("outward");
  });
});

describe("verify helpers", () => {
  it("transitiveDependents follows runtime edges but does not expand private packages", () => {
    const packages = [
      ...workspace(),
      pkg("bases", { peerDependencies: { "@jackyzha0/quartz": "^5.0.0" } }),
    ];
    expect([...transitiveDependents(packages, [T])].sort()).toEqual([
      "@jackyzha0/quartz",
      "@quartz-community/cname",
      "@quartz-community/graph",
      U,
    ]);
    expect([
      ...transitiveDependents(packages, ["@quartz-community/graph"]),
    ]).toEqual(["@jackyzha0/quartz"]);
  });

  it("formatCheckScript never picks a writing script", () => {
    expect(formatCheckScript({ format: "prettier . --check" })).toBe("format");
    expect(formatCheckScript({ format: "prettier . --write" })).toBeNull();
    expect(
      formatCheckScript({
        format: "prettier --write .",
        "check-formatting": "prettier . --check",
      }),
    ).toBe("check-formatting");
    expect(formatCheckScript({ "format:check": "x" })).toBe("format:check");
    expect(formatCheckScript(undefined)).toBeNull();
  });

  it("parses turbo run summaries into per-package verdicts", () => {
    const results = parseTurboSummary({
      tasks: [
        { package: "a", task: "build", execution: { exitCode: 0 } },
        { package: "a", task: "test", execution: { exitCode: 1 } },
        { package: "b", task: "build", execution: null },
        { package: "b", task: "lint", command: "<NONEXISTENT>" },
        {
          package: "@quartz-themes/core",
          task: "test",
          execution: { exitCode: 1 },
        },
      ],
    });
    expect(verdictsByPackage(results)).toEqual([
      { name: "@quartz-themes/core", ok: true, tasks: { test: "ignored" } },
      { name: "a", ok: false, tasks: { build: "pass", test: "fail" } },
      { name: "b", ok: false, tasks: { build: "skipped" } },
    ]);
  });
});
