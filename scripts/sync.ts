import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");

function logInfo(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}

function logWarn(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "warn", event, ...data }));
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
  dryRun: boolean,
): Promise<string> {
  if (dryRun) {
    logInfo("dry-run", { command, args, cwd });
    return "";
  }

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
      rejectPromise(
        new Error(
          stderr.trim() || `Command failed (${command} ${args.join(" ")})`,
        ),
      );
    });
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners: Promise<void>[] = [];
  const runNext = async () => {
    const item = queue.shift();
    if (!item) return;
    await worker(item);
    await runNext();
  };

  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    runners.push(runNext());
  }
  await Promise.all(runners);
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const force = Boolean(flags.force);
  const repoFilter = typeof flags.repos === "string" ? flags.repos : "";

  if (!existsSync(REPOS_DIR)) {
    throw new Error("repos/ directory not found");
  }

  const repoDirs = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const selected = repoFilter
    ? repoFilter
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : repoDirs;

  const missing = selected.filter((name) => !repoDirs.includes(name));
  if (missing.length > 0) {
    throw new Error(`Repos not found: ${missing.join(", ")}`);
  }

  const results: { name: string; status: string; changed: boolean }[] = [];
  await runWithConcurrency(selected, 8, async (name) => {
    const repoPath = join(REPOS_DIR, name);
    logInfo("sync-start", { repo: name });
    await runCommand("git", ["fetch", "origin"], repoPath, dryRun);

    const dirty = await runCommand(
      "git",
      ["status", "--porcelain"],
      repoPath,
      dryRun,
    );

    if (dirty && !force) {
      logWarn("sync-skip-dirty", { repo: name });
      results.push({ name, status: "dirty", changed: false });
      return;
    }

    const before = await runCommand(
      "git",
      ["rev-parse", "HEAD"],
      repoPath,
      dryRun,
    );
    await runCommand("git", ["pull", "--ff-only"], repoPath, dryRun);
    const after = await runCommand(
      "git",
      ["rev-parse", "HEAD"],
      repoPath,
      dryRun,
    );

    const changed = before !== "" && after !== "" ? before !== after : false;
    results.push({ name, status: "synced", changed });
    logInfo("sync-done", { repo: name, changed });
  });

  const changedAny = results.some((r) => r.changed);
  if (changedAny) {
    if (dryRun) {
      logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
    } else {
      execSync("pnpm install", { stdio: "inherit", cwd: ROOT });
    }
  } else {
    logInfo("sync-no-changes");
  }

  logInfo("sync-summary", { results });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
