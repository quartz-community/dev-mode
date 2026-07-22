import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");

function logInfo(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, ...data }));
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

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const force = Boolean(flags.force);
  const pluginName = positional[0];
  if (!pluginName) {
    throw new Error("Usage: pnpm remove-plugin <name> [--force] [--dry-run]");
  }

  const targetDir = join(REPOS_DIR, pluginName);
  if (!existsSync(targetDir)) {
    throw new Error(`Repo not found: ${targetDir}`);
  }

  const status = await runCommand(
    "git",
    ["status", "--porcelain"],
    targetDir,
    dryRun,
  );
  if (status && !force) {
    throw new Error(`Repo has uncommitted changes: ${pluginName}`);
  }

  if (dryRun) {
    logInfo("dry-run", { action: "remove", path: targetDir });
  } else {
    rmSync(targetDir, { recursive: true, force: true });
  }

  await import("./generate-turbo-graph");

  if (dryRun) {
    logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
  } else {
    execSync("pnpm install", { stdio: "inherit", cwd: ROOT });
  }

  logInfo("remove-plugin-summary", { name: pluginName });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
