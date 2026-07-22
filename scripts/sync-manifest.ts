import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "yaml";

type Manifest = {
  org: string;
  plugins: Array<string | { name: string }>;
  infrastructure?: Array<{ name: string }>;
};

const ROOT = resolve(import.meta.dirname, "..");
const DEV_YAML = resolve(ROOT, "dev.yaml");

function ensureToken(): void {
  if (!process.env.GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN is required to sync the manifest.");
    process.exit(1);
  }
}

function listOrgRepos(): Array<{ name: string; description?: string | null }> {
  const output = execSync(
    "gh repo list quartz-community --json name,description --limit 200",
    {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output) as Array<{
    name: string;
    description?: string | null;
  }>;
}

function readManifest(): Manifest {
  const content = readFileSync(DEV_YAML, "utf-8");
  return yaml.parse(content) as Manifest;
}

function writeManifest(manifest: Manifest): void {
  const content = yaml.stringify(manifest, { lineWidth: 0 });
  writeFileSync(DEV_YAML, content);
}

function normalizePlugins(plugins: Array<string | { name: string }>): string[] {
  return plugins.map((entry) =>
    typeof entry === "string" ? entry : entry.name,
  );
}

function main(): void {
  ensureToken();

  const repos = listOrgRepos();
  const manifest = readManifest();

  const existingPlugins = new Set(normalizePlugins(manifest.plugins));
  const infraNames = new Set(
    manifest.infrastructure?.map((entry) => entry.name) ?? [],
  );
  infraNames.add("dev-mode");

  const additions = repos
    .map((repo) => repo.name)
    .filter((name) => !existingPlugins.has(name))
    .filter((name) => !infraNames.has(name))
    .sort((a, b) => a.localeCompare(b));

  if (additions.length === 0) {
    console.log("No new plugins found.");
    return;
  }

  manifest.plugins = [
    ...manifest.plugins,
    ...additions.map((name) => ({ name })),
  ];

  writeManifest(manifest);

  console.log("Added plugins:");
  for (const name of additions) {
    console.log(`- ${name}`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
