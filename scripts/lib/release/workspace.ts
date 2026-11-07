import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { safeReadJson } from "../json.js";
import type { Manifest } from "../types.js";
import type { BumpType } from "./changeset.js";
import { pendingBumpFor, readPendingChangesets } from "./changeset.js";
import type { ReleaseKind } from "./classify.js";
import type { PackageCategory, WorkspacePackage } from "./graph.js";

export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  repository?: string | { url?: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export function githubRepoFrom(pkg: PackageJson): string | undefined {
  const raw =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!raw) return undefined;
  const match = raw.match(/github\.com[/:]([^/]+\/[^/.#]+)(?:\.git)?/);
  if (match) return match[1];
  const shorthand = raw.match(
    /^(?:github:)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/,
  );
  return shorthand?.[1];
}

function readWorkflows(repoPath: string): string {
  const dir = join(repoPath, ".github", "workflows");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => readFileSync(join(dir, file), "utf-8"))
    .join("\n");
}

export function detectReleaseKind(
  repoPath: string,
  pkg: PackageJson,
): ReleaseKind {
  if (pkg.private === true) return "private";
  if (existsSync(join(repoPath, ".changeset", "config.json")))
    return "changesets";
  const workflows = readWorkflows(repoPath);
  if (/npm publish|changeset publish|npm run release/.test(workflows))
    return "tag";
  return "github-release";
}

export function categorize(
  repo: string,
  manifest: Manifest | undefined,
): PackageCategory {
  if (!manifest) return repo === "quartz" ? "core" : "plugins";
  const nameOf = (entry: { name?: string; repo: string }) =>
    entry.name ?? entry.repo.split("/").pop()!;
  if (nameOf(manifest.core) === repo || repo === "quartz") return "core";
  if (manifest.infrastructure.some((entry) => nameOf(entry) === repo))
    return "infrastructure";
  if (manifest.themes?.packages.some((entry) => nameOf(entry) === repo))
    return "themes";
  if (manifest.tools?.some((entry) => nameOf(entry) === repo)) return "tools";
  return "plugins";
}

export interface LoadedPackage extends WorkspacePackage {
  path: string;
  packageJson: PackageJson;
  hasChangesetDir: boolean;
  pendingChangesets: ReturnType<typeof readPendingChangesets>;
}

export function loadWorkspacePackages(
  reposDir: string,
  manifest?: Manifest,
): LoadedPackage[] {
  if (!existsSync(reposDir)) {
    throw new Error(
      `${reposDir} not found. Run 'just setup' to clone workspace packages`,
    );
  }
  const packages: LoadedPackage[] = [];
  for (const entry of readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(reposDir, entry.name);
    const packagePath = join(path, "package.json");
    if (!existsSync(packagePath) || !existsSync(join(path, ".git"))) continue;
    const packageJson = safeReadJson<PackageJson>(packagePath);
    if (typeof packageJson.name !== "string") continue;
    const changesets = readPendingChangesets(path);
    const pending = pendingBumpFor(changesets.pending, packageJson.name);
    packages.push({
      repo: entry.name,
      name: packageJson.name,
      version: packageJson.version ?? "0.0.0",
      category: categorize(entry.name, manifest),
      kind: detectReleaseKind(path, packageJson),
      githubRepo: githubRepoFrom(packageJson),
      dependencies: packageJson.dependencies ?? {},
      peerDependencies: packageJson.peerDependencies ?? {},
      optionalDependencies: packageJson.optionalDependencies ?? {},
      devDependencies: packageJson.devDependencies ?? {},
      pendingBump:
        pending && pending !== "none" ? (pending as BumpType) : undefined,
      path,
      packageJson,
      hasChangesetDir: changesets.hasChangesetDir,
      pendingChangesets: changesets,
    });
  }
  return packages.sort((a, b) => a.repo.localeCompare(b.repo));
}
