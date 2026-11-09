/**
 * CI dashboard: the latest GitHub Actions result per workflow on each repo's
 * tracked branch (dev.yaml `branch`, else the GitHub default branch), for
 * every repo in dev.yaml. Read-only `gh` calls.
 *
 *   ci-status [repo...] [--prs] [--all] [--concurrency <n>] [--timeout <s>] [--json]
 *
 * --prs  also list open PRs against that branch with their check state
 *        (version PRs from changesets/action get no checks: GITHUB_TOKEN events
 *        don't trigger workflows).
 * --all  list passing repos too (default: only the ones needing attention).
 *
 * Exit: 1 when any tracked branch is failing, 2 when nothing is failing but
 * some lookups errored, else 0.
 */
import { resolve } from "node:path";
import { parseArgs } from "./lib/args.js";
import {
  ageOf,
  ciExitCode,
  ciTargetsFromManifest,
  collectCiStatus,
  prChecksLabel,
  selectCiTargets,
  type GhRunner,
  type RepoCiStatus,
} from "./lib/ci-status.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommandCapture } from "./lib/exec.js";
import { logError } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";

const ROOT = resolve(import.meta.dirname, "..");
const BOOLEAN_FLAGS = ["json", "prs", "all", "help"];

const USAGE = `Usage: just ci-status [repo...] [--prs] [--all] [--concurrency <n>] [--timeout <s>] [--json]

Latest CI result per workflow on each dev.yaml repo's tracked branch (read-only gh calls).
  --prs   also show open PRs and their check state (flags version PRs without checks)
  --all   list passing repos too
Exit 1 when a tracked branch is failing, 2 when only lookups failed.`;

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, index) => (cell ?? "").padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  console.log(format(headers));
  console.log(format(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(format(row));
}

function workflowsCell(status: RepoCiStatus): string {
  if (status.error) return status.error;
  if (status.verdict === "no-workflows") return "(no workflows)";
  return status.workflows
    .map((workflow) => {
      const mark =
        workflow.verdict === "failing"
          ? "FAIL"
          : workflow.verdict === "running"
            ? "running"
            : workflow.verdict === "no-runs"
              ? "no runs"
              : "ok";
      const extra =
        workflow.verdict === "failing"
          ? ` ${ageOf(workflow.createdAt)}`
          : workflow.inProgress && workflow.verdict !== "running"
            ? " (rerunning)"
            : "";
      return `${workflow.name}:${mark}${extra}`;
    })
    .join(", ");
}

const ORDER: RepoCiStatus["verdict"][] = [
  "failing",
  "error",
  "running",
  "no-runs",
  "no-workflows",
  "archived",
  "passing",
];

async function main(): Promise<number> {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const args = [...positional];
  for (const flag of BOOLEAN_FLAGS) {
    if (typeof flags[flag] === "string") {
      args.push(flags[flag] as string);
      flags[flag] = true;
    }
  }
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  const json = Boolean(flags.json);
  const timeoutMs = Number(flags.timeout ?? 30) * 1000;
  const concurrency = Math.min(32, Math.max(1, Number(flags.concurrency ?? 8)));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("--timeout must be a positive number of seconds");

  try {
    await runCommandCapture("gh", ["auth", "status"], ROOT, false, {
      timeout: 15_000,
    });
  } catch (error) {
    throw new Error(
      `gh is not available or not authenticated (gh auth login): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }

  const { selected, unknown } = selectCiTargets(
    ciTargetsFromManifest(readManifest()),
    args,
  );
  if (unknown.length > 0)
    throw new Error(`not in dev.yaml: ${unknown.join(", ")}`);

  const gh: GhRunner = (ghArgs) =>
    runCommandCapture("gh", ghArgs, ROOT, false, { timeout: timeoutMs });
  const statuses: RepoCiStatus[] = [];
  const outcome = await runWithConcurrency(
    selected,
    concurrency,
    async (target) => {
      statuses.push(
        await collectCiStatus(target, gh, { prs: Boolean(flags.prs) }),
      );
    },
  );
  for (const { item, error } of outcome.failures) {
    statuses.push({
      name: item.name,
      repo: item.repo,
      branch: item.branch ?? null,
      verdict: "error",
      workflows: [],
      lastRunAt: null,
      error: error.message,
    });
  }
  statuses.sort(
    (a, b) =>
      ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) ||
      a.name.localeCompare(b.name),
  );
  const exitCode = ciExitCode(statuses);
  const counts = Object.fromEntries(
    ORDER.map((verdict) => [
      verdict,
      statuses.filter((status) => status.verdict === verdict).length,
    ]).filter(([, count]) => count),
  );

  if (json) {
    console.log(
      JSON.stringify({ repos: statuses, summary: counts, exitCode }, null, 2),
    );
    return exitCode;
  }

  const shown = flags.all
    ? statuses
    : statuses.filter((status) => status.verdict !== "passing");
  if (shown.length > 0) {
    printTable(
      ["Repo", "Branch", "CI", "Last run", "Workflows"],
      shown.map((status) => [
        status.name,
        status.branch ?? "?",
        status.verdict,
        ageOf(status.lastRunAt),
        workflowsCell(status),
      ]),
    );
  }
  const failing = statuses.filter((status) => status.verdict === "failing");
  if (failing.length) {
    console.log("\nFailing runs:");
    for (const status of failing) {
      for (const workflow of status.workflows.filter(
        (w) => w.verdict === "failing",
      )) {
        console.log(
          `  ${status.name} ${workflow.name} (${workflow.conclusion}, ${ageOf(workflow.createdAt)} ago, ${workflow.headSha?.slice(0, 7)} "${workflow.title ?? ""}"): ${workflow.runUrl}`,
        );
      }
    }
  }

  if (flags.prs) {
    const rows = statuses.flatMap((status) => [
      ...(status.prs ?? []).map((pr) => [
        status.name,
        `#${pr.number}`,
        prChecksLabel(pr),
        `${pr.isDraft ? "[draft] " : ""}${pr.title}`.slice(0, 60),
        pr.failing.length
          ? `failing: ${pr.failing.join(", ")}`
          : pr.pending.length
            ? `pending: ${pr.pending.join(", ")}`
            : "",
      ]),
      ...(status.prError
        ? [[status.name, "-", "error", status.prError, ""]]
        : []),
    ]);
    console.log("");
    if (rows.length) {
      printTable(["Repo", "PR", "Checks", "Title", "Detail"], rows);
    } else {
      console.log("No open PRs.");
    }
  }

  console.log(
    `\n${statuses.length} repos: ${Object.entries(counts)
      .map(([verdict, count]) => `${verdict} ${count}`)
      .join(", ")}${flags.all ? "" : " (passing repos hidden; --all to list)"}`,
  );
  return exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      logError(error instanceof Error ? error.message : String(error), {
        usage: USAGE,
      });
      process.exit(1);
    });
}
