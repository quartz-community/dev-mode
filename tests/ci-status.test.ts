import { describe, expect, it } from "vitest";
import {
  ageOf,
  ciExitCode,
  ciTargetsFromManifest,
  collectCiStatus,
  countedWorkflows,
  ghErrorMessage,
  prChecksLabel,
  repoVerdict,
  selectCiTargets,
  summarizeChecks,
  summarizePr,
  summarizeWorkflow,
  type GhRun,
  type GhRunner,
  type GhWorkflow,
  type RepoCiStatus,
} from "../scripts/lib/ci-status.js";
import type { Manifest } from "../scripts/lib/types.js";

const manifest: Manifest = {
  version: 1,
  org: "quartz-community",
  core: { repo: "jackyzha0/quartz", branch: "v5" },
  infrastructure: [{ name: "types", repo: "quartz-community/types" }],
  themes: {
    org: "quartz-themes",
    packages: [{ name: "quartz-themes-core", repo: "quartz-themes/core" }],
  },
  plugins: [{ name: "graph" }, { name: "tui", standalone: true }],
  tools: [{ name: "syncer", repo: "saberzero1/quartz-syncer", branch: "main" }],
};

const ci: GhWorkflow = {
  id: 1,
  name: "CI",
  path: ".github/workflows/ci.yml",
  state: "active",
};
const release: GhWorkflow = {
  id: 2,
  name: "Release",
  path: ".github/workflows/release.yml",
  state: "active",
};

function run(
  workflow: number,
  conclusion: string | null,
  overrides: Partial<GhRun> = {},
): GhRun {
  return {
    id: Math.floor(Math.random() * 1e9),
    name: workflow === 1 ? "CI" : "Release",
    workflow_id: workflow,
    event: "push",
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    head_sha: "abcdef1234567",
    created_at: "2026-02-01T00:00:00Z",
    html_url: `https://github.com/x/y/actions/runs/${workflow}`,
    display_title: "chore: thing",
    ...overrides,
  };
}

describe("ciTargetsFromManifest", () => {
  it("covers core, infrastructure, themes, plugins and tools with tracked branches", () => {
    expect(ciTargetsFromManifest(manifest)).toEqual([
      { name: "quartz", repo: "jackyzha0/quartz", branch: "v5" },
      { name: "types", repo: "quartz-community/types", branch: undefined },
      {
        name: "quartz-themes-core",
        repo: "quartz-themes/core",
        branch: undefined,
      },
      { name: "graph", repo: "quartz-community/graph" },
      { name: "tui", repo: "quartz-community/tui" },
      { name: "syncer", repo: "saberzero1/quartz-syncer", branch: "main" },
    ]);
  });

  it("selects by dir name, owner/repo or repo name and reports unknowns", () => {
    const targets = ciTargetsFromManifest(manifest);
    const { selected, unknown } = selectCiTargets(targets, [
      "graph",
      "quartz-themes/core",
      "quartz-syncer",
      "nope",
    ]);
    expect(selected.map((t) => t.name)).toEqual([
      "graph",
      "quartz-themes-core",
      "syncer",
    ]);
    expect(unknown).toEqual(["nope"]);
  });
});

describe("summarizeWorkflow", () => {
  it("uses the newest completed run", () => {
    const summary = summarizeWorkflow(ci, [
      run(1, "failure"),
      run(1, "success"),
    ]);
    expect(summary.verdict).toBe("failing");
    expect(summary.conclusion).toBe("failure");
  });

  it("looks past skipped/cancelled runs and notes an in-progress rerun", () => {
    const summary = summarizeWorkflow(ci, [
      run(1, null),
      run(1, "cancelled"),
      run(1, "skipped"),
      run(1, "success"),
    ]);
    expect(summary.verdict).toBe("passing");
    expect(summary.inProgress).toBe(true);
  });

  it("is running when only in-progress runs exist and no-runs when empty", () => {
    expect(summarizeWorkflow(ci, [run(1, null)]).verdict).toBe("running");
    expect(summarizeWorkflow(ci, []).verdict).toBe("no-runs");
  });

  it("ignores runs of other workflows", () => {
    expect(summarizeWorkflow(ci, [run(2, "failure")]).verdict).toBe("no-runs");
  });

  it.each(["timed_out", "startup_failure", "action_required"])(
    "treats %s as failing",
    (conclusion) => {
      expect(summarizeWorkflow(ci, [run(1, conclusion)]).verdict).toBe(
        "failing",
      );
    },
  );
});

describe("countedWorkflows / repoVerdict", () => {
  it("drops dynamic and disabled workflows", () => {
    expect(
      countedWorkflows([
        ci,
        {
          id: 3,
          name: "Dependabot",
          path: "dynamic/dependabot",
          state: "active",
        },
        { ...release, state: "disabled_manually" },
      ]),
    ).toEqual([ci]);
  });

  it("orders failing > running > passing > no-runs", () => {
    const pass = summarizeWorkflow(ci, [run(1, "success")]);
    const fail = summarizeWorkflow(release, [run(2, "failure")]);
    const running = summarizeWorkflow(release, [run(2, null)]);
    expect(repoVerdict([pass, fail], true)).toBe("failing");
    expect(repoVerdict([pass, running], true)).toBe("running");
    expect(repoVerdict([pass], true)).toBe("passing");
    expect(repoVerdict([summarizeWorkflow(ci, [])], true)).toBe("no-runs");
    expect(repoVerdict([], false)).toBe("no-workflows");
  });
});

describe("summarizeChecks / summarizePr", () => {
  it("has no checks for an empty rollup (version PR opened by GITHUB_TOKEN)", () => {
    const pr = summarizePr({
      number: 10,
      title: "chore: version package",
      headRefName: "changeset-release/main",
      url: "u",
      statusCheckRollup: [],
    });
    expect(pr.verdict).toBe("no-checks");
    expect(pr.versionPr).toBe(true);
    expect(prChecksLabel(pr)).toContain("GITHUB_TOKEN");
  });

  it("flags fork PRs without checks as possibly awaiting approval", () => {
    const pr = summarizePr({
      number: 3,
      title: "fix",
      headRefName: "patch-1",
      url: "u",
      isCrossRepository: true,
      statusCheckRollup: null,
    });
    expect(prChecksLabel(pr)).toContain("fork");
  });

  it("mixes check runs and commit statuses", () => {
    expect(
      summarizeChecks([
        {
          __typename: "CheckRun",
          name: "check",
          workflowName: "CI",
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
        {
          __typename: "StatusContext",
          context: "version-pr/check",
          state: "FAILURE",
        },
      ]),
    ).toEqual({
      verdict: "failing",
      failing: ["version-pr/check"],
      pending: [],
    });
    expect(
      summarizeChecks([
        { __typename: "CheckRun", name: "build", status: "IN_PROGRESS" },
        {
          __typename: "CheckRun",
          name: "skip",
          status: "COMPLETED",
          conclusion: "SKIPPED",
        },
      ]),
    ).toEqual({ verdict: "pending", failing: [], pending: ["build"] });
    expect(
      summarizeChecks([
        {
          __typename: "CheckRun",
          name: "skip",
          status: "COMPLETED",
          conclusion: "SKIPPED",
        },
      ]).verdict,
    ).toBe("no-checks");
  });
});

describe("collectCiStatus", () => {
  function fakeGh(responses: Record<string, string | Error>): GhRunner {
    return async (args) => {
      const key =
        args[0] === "pr" ? `pr ${args[3]}` : args[1].replace(/\?.*$/, "");
      const response = responses[key];
      if (response === undefined)
        throw new Error(`unexpected gh ${args.join(" ")}`);
      if (response instanceof Error) throw response;
      return response;
    };
  }

  it("reports a failing default branch from the per-workflow runs", async () => {
    const gh = fakeGh({
      "repos/quartz-community/tui": JSON.stringify({
        default_branch: "main",
        archived: false,
      }),
      "repos/quartz-community/tui/actions/workflows": JSON.stringify([ci]),
      "repos/quartz-community/tui/actions/workflows/1/runs": JSON.stringify([
        run(1, "failure", { created_at: "2026-03-16T17:57:10Z" }),
      ]),
      "pr quartz-community/tui": JSON.stringify([]),
    });
    const status = await collectCiStatus(
      { name: "tui", repo: "quartz-community/tui" },
      gh,
      { prs: true },
    );
    expect(status.branch).toBe("main");
    expect(status.verdict).toBe("failing");
    expect(status.lastRunAt).toBe("2026-03-16T17:57:10Z");
    expect(status.prs).toEqual([]);
  });

  it("honours a pinned branch and handles repos without workflows", async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      if (args[1] === "repos/jackyzha0/quartz")
        return JSON.stringify({ default_branch: "v4", archived: false });
      return "[]";
    };
    const status = await collectCiStatus(
      { name: "quartz", repo: "jackyzha0/quartz", branch: "v5" },
      gh,
    );
    expect(status.branch).toBe("v5");
    expect(status.verdict).toBe("no-workflows");
    expect(calls).toHaveLength(2);
  });

  it("turns gh API errors into an error verdict", async () => {
    const gh = fakeGh({
      "repos/quartz-community/gone": new Error(
        "some noise\ngh: Not Found (HTTP 404)",
      ),
    });
    const status = await collectCiStatus(
      { name: "gone", repo: "quartz-community/gone" },
      gh,
    );
    expect(status.verdict).toBe("error");
    expect(status.error).toBe("Not Found (HTTP 404)");
  });

  it("reports archived repos without further calls", async () => {
    const gh = fakeGh({
      "repos/a/b": JSON.stringify({ default_branch: "main", archived: true }),
    });
    expect(
      (await collectCiStatus({ name: "b", repo: "a/b" }, gh)).verdict,
    ).toBe("archived");
  });

  it("keeps the branch result when only the PR lookup fails", async () => {
    const gh = fakeGh({
      "repos/a/b": JSON.stringify({ default_branch: "main", archived: false }),
      "repos/a/b/actions/workflows": "[]",
      "pr a/b": new Error("gh: HTTP 502"),
    });
    const status = await collectCiStatus({ name: "b", repo: "a/b" }, gh, {
      prs: true,
    });
    expect(status.verdict).toBe("no-workflows");
    expect(status.prError).toBe("HTTP 502");
  });

  it("rejects non-JSON gh output as an error", async () => {
    const gh = fakeGh({ "repos/a/b": "<html>rate limited</html>" });
    const status = await collectCiStatus({ name: "b", repo: "a/b" }, gh);
    expect(status.verdict).toBe("error");
    expect(status.error).toContain("unexpected gh output");
  });
});

describe("helpers", () => {
  it("formats ages", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(ageOf("2026-11-08T11:30:00Z", now)).toBe("30m");
    expect(ageOf("2026-11-07T12:00:00Z", now)).toBe("24h");
    expect(ageOf("2026-03-16T12:00:00Z", now)).toBe("237d");
    expect(ageOf(null, now)).toBe("-");
  });

  it("picks the exit code", () => {
    const status = (verdict: RepoCiStatus["verdict"]): RepoCiStatus => ({
      name: verdict,
      repo: `x/${verdict}`,
      branch: "main",
      verdict,
      workflows: [],
      lastRunAt: null,
    });
    expect(ciExitCode([status("passing"), status("no-workflows")])).toBe(0);
    expect(ciExitCode([status("passing"), status("error")])).toBe(2);
    expect(ciExitCode([status("error"), status("failing")])).toBe(1);
  });

  it("extracts the gh message line", () => {
    expect(ghErrorMessage(new Error("gh: Bad credentials (HTTP 401)"))).toBe(
      "Bad credentials (HTTP 401)",
    );
    expect(
      ghErrorMessage(new Error("Command timed out after 30000ms: gh api")),
    ).toBe("Command timed out after 30000ms: gh api");
  });
});
