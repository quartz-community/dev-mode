import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");

interface RepoStatus {
  repo: string;
  packageName: string;
  branch: string;
  dirty: boolean;
  behind: number | null;
}

function logError(message: string, data: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", message, ...data }));
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }
      rejectPromise(new Error(stderr.trim() || "Command failed"));
    });
  });
}

function readPackageName(repoPath: string, fallback: string): string {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return fallback;
  const data = JSON.parse(readFileSync(pkgPath, "utf-8"));
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
    throw new Error("repos/ directory not found");
  }

  const repoDirs = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const statuses: RepoStatus[] = [];
  for (const repo of repoDirs) {
    const repoPath = join(REPOS_DIR, repo);
    const packageName = readPackageName(repoPath, repo);
    const branch = await runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoPath,
    );
    const dirtyOutput = await runCommand(
      "git",
      ["status", "--porcelain"],
      repoPath,
    );
    let behind: number | null = null;
    try {
      const behindRaw = await runCommand(
        "git",
        ["rev-list", "--count", "HEAD...@{u}"],
        repoPath,
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
  }

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
