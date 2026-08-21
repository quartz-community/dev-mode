import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "./lib/args.js";
import { runWithConcurrency } from "./lib/concurrency.js";
import { runCommandCapture } from "./lib/exec.js";
import { safeReadJson } from "./lib/json.js";
import { logError } from "./lib/log.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");

interface RepoStatus {
  repo: string;
  packageName: string;
  branch: string;
  dirty: boolean;
  behind: number | null;
}


function readPackageName(repoPath: string, fallback: string): string {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return fallback;
  const data = safeReadJson<Record<string, unknown>>(pkgPath);
  return typeof data.name === "string" ? data.name : fallback;
}

function printTable(rows: RepoStatus[]): void {
  const headers = ["Repo", "Package", "Branch", "Dirty", "Behind"];
  const data = rows.map((row) => [
    row.repo,
    row.packageName,
    row.branch,
    row.dirty ? "yes" : "no",
    row.behind === null ? "-" : String(row.behind),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...data.map((row) => row[index].length)),
  );

  const formatRow = (cells: string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]))
      .join("  ")
      .trimEnd();

  console.log(formatRow(headers));
  console.log(formatRow(headers.map((header) => "-".repeat(header.length))));
  data.forEach((row) => {
    console.log(formatRow(row));
  });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const jsonOutput = Boolean(flags.json);

  if (!existsSync(REPOS_DIR)) {
    throw new Error("repos/ directory not found. Run 'just setup' to clone workspace packages");
  }

  const repoDirs = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const statuses: RepoStatus[] = [];
  await runWithConcurrency(repoDirs, 8, async (repo) => {
    const repoPath = join(REPOS_DIR, repo);
    const packageName = readPackageName(repoPath, repo);
    const branch = await runCommandCapture(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoPath,
      false,
    );
    const dirtyOutput = await runCommandCapture(
      "git",
      ["status", "--porcelain"],
      repoPath,
      false,
    );
    let behind: number | null = null;
    try {
      const behindRaw = await runCommandCapture(
        "git",
        ["rev-list", "--count", "HEAD...@{u}"],
        repoPath,
        false,
      );
      behind = Number(behindRaw);
      if (!Number.isFinite(behind)) behind = null;
    } catch {
      behind = null;
    }

    statuses.push({
      repo,
      packageName,
      branch,
      dirty: dirtyOutput.length > 0,
      behind,
    });
  });

  statuses.sort((a, b) => a.repo.localeCompare(b.repo));

  if (jsonOutput) {
    console.log(JSON.stringify({ repos: statuses }, null, 2));
  } else {
    printTable(statuses);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
