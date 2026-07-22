import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
const MANIFEST_PATH = join(ROOT, "dev.yaml");

interface ManifestPlugin {
  name: string;
  repo?: string;
}

interface Manifest {
  version: number;
  org: string;
  plugins: ManifestPlugin[];
}

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

function readManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return parse(raw) as Manifest;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    logInfo("dry-run", { command, args, cwd });
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Command failed (${command} ${args.join(" ")})`));
    });
  });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(flags["dry-run"]);
  const pluginName = positional[0];
  if (!pluginName) {
    throw new Error(
      "Usage: pnpm add-plugin <name> [--repo <owner/repo>] [--dry-run]",
    );
  }

  const manifest = readManifest();
  const repoOverride = typeof flags.repo === "string" ? flags.repo : undefined;
  const manifestEntry = manifest.plugins.find((p) => p.name === pluginName);
  const repo =
    repoOverride ?? manifestEntry?.repo ?? `${manifest.org}/${pluginName}`;

  if (!existsSync(REPOS_DIR)) {
    if (dryRun) {
      logInfo("dry-run", { action: "mkdir", path: REPOS_DIR });
    } else {
      mkdirSync(REPOS_DIR, { recursive: true });
    }
  }

  const targetDir = join(REPOS_DIR, pluginName);
  if (existsSync(targetDir)) {
    throw new Error(`Repo already exists: ${targetDir}`);
  }

  logInfo("clone-start", { repo, path: targetDir });
  await runCommand(
    "git",
    [
      "clone",
      "--depth=1",
      "--single-branch",
      `https://github.com/${repo}.git`,
      targetDir,
    ],
    ROOT,
    dryRun,
  );
  logInfo("clone-done", { repo, path: targetDir });

  await import("./generate-turbo-graph");

  if (dryRun) {
    logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
    logInfo("dry-run", {
      action: "pnpm-turbo-build",
      filter: `@${manifest.org}/${pluginName}`,
      cwd: ROOT,
    });
  } else {
    execSync("pnpm install", { stdio: "inherit", cwd: ROOT });
    execSync(`pnpm turbo run build --filter=@${manifest.org}/${pluginName}`, {
      stdio: "inherit",
      cwd: ROOT,
    });
  }

  logInfo("add-plugin-summary", { name: pluginName, repo });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
