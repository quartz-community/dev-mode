import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
const MANIFEST_PATH = join(ROOT, "dev.yaml");

interface ManifestRepo {
  name?: string;
  repo: string;
  branch?: string;
}

interface ManifestPlugin {
  name: string;
  repo?: string;
}

interface ManifestPreset {
  description?: string;
  plugins: string[];
}

interface Manifest {
  version: number;
  org: string;
  core: ManifestRepo;
  infrastructure: ManifestRepo[];
  plugins: ManifestPlugin[];
  presets?: Record<string, ManifestPreset>;
}

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

function readManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return parse(raw) as Manifest;
}

function normalizeRepo(name: string, repo: string, branch?: string) {
  return { name, repo, branch };
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
  const preset = typeof flags.preset === "string" ? flags.preset : undefined;
  const pluginList = typeof flags.plugins === "string" ? flags.plugins : "";
  const concurrency = Number(flags.concurrency ?? 8);
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("--concurrency must be a positive number");
  }

  const manifest = readManifest();
  const manifestPlugins = manifest.plugins.map((p) => p.name);
  const selectedPlugins = new Set<string>();

  if (preset) {
    const presetConfig = manifest.presets?.[preset];
    if (!presetConfig) {
      throw new Error(`Unknown preset: ${preset}`);
    }
    if (presetConfig.plugins.includes("*")) {
      manifestPlugins.forEach((name) => selectedPlugins.add(name));
    } else {
      presetConfig.plugins.forEach((name) => selectedPlugins.add(name));
    }
  }

  if (pluginList) {
    pluginList
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => selectedPlugins.add(name));
  }

  const repos: ManifestRepo[] = [];
  repos.push(normalizeRepo("quartz", manifest.core.repo, manifest.core.branch));
  manifest.infrastructure.forEach((infra) => {
    repos.push(normalizeRepo(infra.name ?? infra.repo, infra.repo));
  });

  for (const plugin of selectedPlugins) {
    const manifestEntry = manifest.plugins.find((p) => p.name === plugin);
    const repo = manifestEntry?.repo ?? `${manifest.org}/${plugin}`;
    repos.push(normalizeRepo(plugin, repo));
  }

  if (!existsSync(REPOS_DIR)) {
    if (dryRun) {
      logInfo("dry-run", { action: "mkdir", path: REPOS_DIR });
    } else {
      mkdirSync(REPOS_DIR, { recursive: true });
    }
  }

  const clones: { name: string; status: "cloned" | "skipped" }[] = [];

  await runWithConcurrency(repos, concurrency, async (repo) => {
    const targetDir = join(REPOS_DIR, repo.name ?? repo.repo);
    if (existsSync(targetDir)) {
      logWarn("clone-skip", { repo: repo.repo, path: targetDir });
      clones.push({ name: repo.name ?? repo.repo, status: "skipped" });
      return;
    }

    const args = [
      "clone",
      "--depth=1",
      "--single-branch",
      ...(repo.branch ? ["--branch", repo.branch] : []),
      `https://github.com/${repo.repo}.git`,
      targetDir,
    ];

    logInfo("clone-start", { repo: repo.repo, path: targetDir });
    await runCommand("git", args, ROOT, dryRun);
    logInfo("clone-done", { repo: repo.repo, path: targetDir });
    clones.push({ name: repo.name ?? repo.repo, status: "cloned" });
  });

  await import("./generate-turbo-graph");

  if (dryRun) {
    logInfo("dry-run", { action: "pnpm-install", cwd: ROOT });
    logInfo("dry-run", { action: "pnpm-turbo-build", cwd: ROOT });
  } else {
    execSync("pnpm install", { stdio: "inherit", cwd: ROOT });
    execSync("pnpm turbo run build", { stdio: "inherit", cwd: ROOT });
  }

  logInfo("setup-summary", {
    total: clones.length,
    cloned: clones.filter((c) => c.status === "cloned").length,
    skipped: clones.filter((c) => c.status === "skipped").length,
    plugins: [...selectedPlugins],
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
