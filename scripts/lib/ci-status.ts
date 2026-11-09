/**
 * Latest GitHub Actions result on each repo's tracked branch (and optionally
 * the check state of its open PRs), via the `gh` CLI. Read-only.
 *
 * Every gh call goes through an injected runner so tests can feed canned JSON.
 */
import type { Manifest } from "./types.js";

export type GhRunner = (args: string[]) => Promise<string>;

export interface CiTarget {
  /** Directory name under repos/ (= dev.yaml name). */
  name: string;
  /** owner/repo on GitHub. */
  repo: string;
  /** Branch pinned in dev.yaml; otherwise the GitHub default branch. */
  branch?: string;
}

export type CiVerdict =
  | "failing"
  | "running"
  | "passing"
  | "no-workflows"
  | "no-runs"
  | "archived"
  | "error";

export type WorkflowVerdict = "failing" | "passing" | "running" | "no-runs";

export interface WorkflowSummary {
  name: string;
  path: string;
  verdict: WorkflowVerdict;
  /** Conclusion of the latest completed (non-skipped/cancelled) run. */
  conclusion: string | null;
  runUrl: string | null;
  headSha: string | null;
  createdAt: string | null;
  title: string | null;
  /** The newest run is still queued/in progress. */
  inProgress: boolean;
}

export type CheckVerdict = "failing" | "pending" | "passing" | "no-checks";

export interface PrSummary {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  isDraft: boolean;
  verdict: CheckVerdict;
  failing: string[];
  pending: string[];
  /** changesets/action PR: GITHUB_TOKEN events trigger no workflows. */
  versionPr: boolean;
  /** From a fork: workflows may be waiting for maintainer approval. */
  fromFork: boolean;
}

export interface RepoCiStatus {
  name: string;
  repo: string;
  branch: string | null;
  verdict: CiVerdict;
  workflows: WorkflowSummary[];
  /** Newest run across the counted workflows. */
  lastRunAt: string | null;
  error?: string;
  prs?: PrSummary[];
  prError?: string;
}

// --------------------------------------------------------------------------
// targets
// --------------------------------------------------------------------------

export function ciTargetsFromManifest(manifest: Manifest): CiTarget[] {
  const nameOf = (entry: { name?: string; repo: string }) =>
    entry.name ?? entry.repo.split("/").pop()!;
  const targets: CiTarget[] = [
    {
      name: manifest.core.name ?? "quartz",
      repo: manifest.core.repo,
      branch: manifest.core.branch,
    },
    ...manifest.infrastructure.map((entry) => ({
      name: nameOf(entry),
      repo: entry.repo,
      branch: entry.branch,
    })),
    ...(manifest.themes?.packages ?? []).map((entry) => ({
      name: nameOf(entry),
      repo: entry.repo,
      branch: entry.branch,
    })),
    ...manifest.plugins.map((plugin) => ({
      name: plugin.name,
      repo: plugin.repo ?? `${manifest.org}/${plugin.name}`,
    })),
    ...(manifest.tools ?? []).map((entry) => ({
      name: nameOf(entry),
      repo: entry.repo,
      branch: entry.branch,
    })),
  ];
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.repo)) return false;
    seen.add(target.repo);
    return true;
  });
}

export function selectCiTargets(
  targets: CiTarget[],
  queries: string[],
): { selected: CiTarget[]; unknown: string[] } {
  if (queries.length === 0) return { selected: targets, unknown: [] };
  const unknown: string[] = [];
  const selected: CiTarget[] = [];
  for (const query of queries) {
    const match = targets.find(
      (target) =>
        target.name === query ||
        target.repo === query ||
        target.repo.split("/")[1] === query,
    );
    if (!match) unknown.push(query);
    else if (!selected.includes(match)) selected.push(match);
  }
  return { selected, unknown };
}

// --------------------------------------------------------------------------
// parsing (pure)
// --------------------------------------------------------------------------

export interface GhWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface GhRun {
  id: number;
  name: string | null;
  workflow_id: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_sha: string;
  created_at: string;
  html_url: string;
  display_title?: string;
}

const FAILED = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "action_required",
]);
/** Runs that say nothing about the code: look further back. */
const IGNORED = new Set(["skipped", "cancelled", "neutral", "stale"]);

/**
 * Active, file-backed workflows only: dynamic ones (Dependabot, CodeQL
 * default setup, Copilot) and disabled/deleted workflows don't count.
 */
export function countedWorkflows(workflows: GhWorkflow[]): GhWorkflow[] {
  return workflows.filter(
    (workflow) =>
      workflow.state === "active" &&
      workflow.path.startsWith(".github/workflows/"),
  );
}

/** `runs` newest first, as the API returns them. */
export function summarizeWorkflow(
  workflow: GhWorkflow,
  runs: GhRun[],
): WorkflowSummary {
  const own = runs.filter((run) => run.workflow_id === workflow.id);
  const inProgress = own[0] ? own[0].status !== "completed" : false;
  const decisive = own.find(
    (run) =>
      run.status === "completed" && !IGNORED.has(run.conclusion ?? "skipped"),
  );
  const shown = decisive ?? own[0];
  const verdict: WorkflowVerdict = decisive
    ? FAILED.has(decisive.conclusion ?? "")
      ? "failing"
      : "passing"
    : inProgress
      ? "running"
      : "no-runs";
  return {
    name: workflow.name,
    path: workflow.path,
    verdict,
    conclusion: decisive?.conclusion ?? null,
    runUrl: shown?.html_url ?? null,
    headSha: shown?.head_sha ?? null,
    createdAt: shown?.created_at ?? null,
    title: shown?.display_title ?? null,
    inProgress,
  };
}

export function repoVerdict(
  workflows: WorkflowSummary[],
  hasAnyWorkflow: boolean,
): CiVerdict {
  if (!hasAnyWorkflow) return "no-workflows";
  if (workflows.some((workflow) => workflow.verdict === "failing"))
    return "failing";
  if (workflows.some((workflow) => workflow.verdict === "running"))
    return "running";
  if (workflows.some((workflow) => workflow.verdict === "passing"))
    return "passing";
  return "no-runs";
}

export interface GhCheck {
  __typename?: string;
  name?: string;
  context?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
}

export interface GhPr {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  isDraft?: boolean;
  isCrossRepository?: boolean;
  statusCheckRollup?: GhCheck[] | null;
}

export function summarizeChecks(checks: GhCheck[] | null | undefined): {
  verdict: CheckVerdict;
  failing: string[];
  pending: string[];
} {
  const failing: string[] = [];
  const pending: string[] = [];
  let counted = 0;
  for (const check of checks ?? []) {
    const label =
      check.__typename === "StatusContext"
        ? (check.context ?? "status")
        : [check.workflowName, check.name].filter(Boolean).join(" / ") ||
          "check";
    if (check.__typename === "StatusContext" || check.state) {
      const state = (check.state ?? "").toUpperCase();
      counted += 1;
      if (state === "FAILURE" || state === "ERROR") failing.push(label);
      else if (state === "PENDING" || state === "EXPECTED") pending.push(label);
      continue;
    }
    const conclusion = (check.conclusion ?? "").toLowerCase();
    if (check.status?.toUpperCase() !== "COMPLETED") {
      counted += 1;
      pending.push(label);
      continue;
    }
    if (IGNORED.has(conclusion)) continue;
    counted += 1;
    if (FAILED.has(conclusion)) failing.push(label);
  }
  const verdict: CheckVerdict = failing.length
    ? "failing"
    : pending.length
      ? "pending"
      : counted
        ? "passing"
        : "no-checks";
  return { verdict, failing, pending };
}

export function prChecksLabel(pr: PrSummary): string {
  if (pr.verdict !== "no-checks") return pr.verdict;
  if (pr.versionPr) return "no-checks (version PR: GITHUB_TOKEN runs no CI)";
  if (pr.fromFork) return "no-checks (fork: awaiting approval?)";
  return "no-checks";
}

export function summarizePr(pr: GhPr): PrSummary {
  return {
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    url: pr.url,
    isDraft: Boolean(pr.isDraft),
    versionPr: pr.headRefName.startsWith("changeset-release/"),
    fromFork: Boolean(pr.isCrossRepository),
    ...summarizeChecks(pr.statusCheckRollup),
  };
}

function parseJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`unexpected gh output for ${what}: ${raw.slice(0, 200)}`);
  }
}

/** First meaningful line of a gh error (gh prints the API message). */
export function ghErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line =
    message
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part.startsWith("gh: ") || /HTTP \d{3}/.test(part)) ??
    message.split("\n")[0];
  return line.replace(/^gh: /, "").slice(0, 200);
}

// --------------------------------------------------------------------------
// collection
// --------------------------------------------------------------------------

export interface CollectOptions {
  prs?: boolean;
  /** Runs fetched per workflow (newest first) to find its latest decisive one. */
  runLimit?: number;
}

export async function collectCiStatus(
  target: CiTarget,
  gh: GhRunner,
  options: CollectOptions = {},
): Promise<RepoCiStatus> {
  const base: RepoCiStatus = {
    name: target.name,
    repo: target.repo,
    branch: target.branch ?? null,
    verdict: "error",
    workflows: [],
    lastRunAt: null,
  };
  try {
    const meta = parseJson<{ default_branch: string; archived: boolean }>(
      await gh([
        "api",
        `repos/${target.repo}`,
        "--jq",
        "{default_branch, archived}",
      ]),
      `${target.repo} metadata`,
    );
    const branch = target.branch ?? meta.default_branch;
    base.branch = branch;
    if (meta.archived) return { ...base, verdict: "archived" };

    const workflows = parseJson<GhWorkflow[]>(
      await gh([
        "api",
        `repos/${target.repo}/actions/workflows?per_page=100`,
        "--jq",
        "[.workflows[] | {id, name, path, state}]",
      ]),
      `${target.repo} workflows`,
    );
    const counted = countedWorkflows(workflows);
    if (counted.length === 0) {
      base.verdict = "no-workflows";
    } else {
      // Per workflow, so a rarely-run workflow isn't crowded out by busy ones.
      const runsByWorkflow = await Promise.all(
        counted.map(async (workflow) =>
          parseJson<GhRun[]>(
            await gh([
              "api",
              `repos/${target.repo}/actions/workflows/${workflow.id}/runs?branch=${encodeURIComponent(branch)}&per_page=${options.runLimit ?? 10}&exclude_pull_requests=true`,
              "--jq",
              "[.workflow_runs[] | {id, name, workflow_id, event, status, conclusion, head_sha, created_at, html_url, display_title}]",
            ]),
            `${target.repo} ${workflow.name} runs`,
          ),
        ),
      );
      base.workflows = counted
        .map((workflow, index) =>
          summarizeWorkflow(workflow, runsByWorkflow[index]),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      base.verdict = repoVerdict(base.workflows, true);
      base.lastRunAt =
        base.workflows
          .map((workflow) => workflow.createdAt)
          .filter((date): date is string => Boolean(date))
          .sort()
          .at(-1) ?? null;
    }
  } catch (error) {
    return { ...base, verdict: "error", error: ghErrorMessage(error) };
  }

  if (options.prs) {
    try {
      const prs = parseJson<GhPr[]>(
        await gh([
          "pr",
          "list",
          "-R",
          target.repo,
          "--state",
          "open",
          "--base",
          base.branch!,
          "--limit",
          "50",
          "--json",
          "number,title,headRefName,url,isDraft,isCrossRepository,statusCheckRollup",
        ]),
        `${target.repo} PRs`,
      );
      base.prs = prs.map(summarizePr);
    } catch (error) {
      base.prError = ghErrorMessage(error);
    }
  }
  return base;
}

// --------------------------------------------------------------------------
// reporting helpers
// --------------------------------------------------------------------------

export function ageOf(iso: string | null, now = Date.now()): string {
  if (!iso) return "-";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "-";
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** 1 = some tracked branch is failing; 2 = no failure seen but lookups errored. */
export function ciExitCode(statuses: RepoCiStatus[]): number {
  if (statuses.some((status) => status.verdict === "failing")) return 1;
  if (statuses.some((status) => status.verdict === "error")) return 2;
  return 0;
}
