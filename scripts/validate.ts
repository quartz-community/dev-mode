import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { safeReadJson } from "./lib/json.js";
import { TIMEOUTS } from "./lib/exec.js";
import { readManifest } from "./lib/manifest.js";
import { parseVersion, satisfiesRange } from "./lib/semver.js";

type CheckResult = {
  name: string;
  ok: boolean;
  details: string[];
};

type PackageJson = {
  name?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  quartz?: Record<string, unknown>;
};

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");

function readJson<T>(path: string): T {
  return safeReadJson<T>(path);
}

function readPackageJson(dir: string): PackageJson | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  return readJson<PackageJson>(pkgPath);
}


function runCommand(command: string): { output: string; error?: string } {
  try {
    const output = execSync(command, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUTS.GIT_OP,
    });
    return { output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n");
    return { output, error: err.message ?? "Command failed" };
  }
}

function getWorkspacePackages(): Array<{ dir: string; pkg: PackageJson }> {
  if (!existsSync(REPOS_DIR)) return [];
  return readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dir: join(REPOS_DIR, entry.name),
      pkg: readPackageJson(join(REPOS_DIR, entry.name)) ?? {},
    }))
    .filter((entry) => entry.pkg.name);
}

function checkSingletons(): CheckResult {
  const manifest = readManifest();
  const deps = manifest.workspace?.singletons ?? ["preact", "unified", "vfile"];
  const details: string[] = [];
  let ok = true;

  for (const dep of deps) {
    const result = runCommand(`pnpm why ${dep}`);
    if (result.error || !result.output.includes("Found 1 version")) {
      ok = false;
      details.push(`${dep}: expected "Found 1 version"`);
      if (result.output.trim()) {
        details.push(result.output.trim());
      }
    }
  }

  return { name: "Singletons", ok, details };
}

function checkOverrides(
  packages: Array<{ dir: string; pkg: PackageJson }>,
): CheckResult {
  const workspaceNames = new Set(
    packages.map((entry) => entry.pkg.name).filter(Boolean) as string[],
  );
  const details: string[] = [];
  let ok = true;

  for (const { pkg } of packages) {
    if (!pkg.name) continue;
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    } as Record<string, string>;

    for (const depName of Object.keys(allDeps)) {
      if (!depName.startsWith("@quartz-community/")) continue;
      if (!workspaceNames.has(depName)) continue;

      const result = runCommand(`pnpm ls ${depName} --filter ${pkg.name}`);
      if (result.error || !result.output.includes("link:")) {
        ok = false;
        details.push(`${pkg.name} -> ${depName}: expected link: resolution`);
        if (result.output.trim()) {
          details.push(result.output.trim());
        }
      }
    }
  }

  return { name: "Overrides", ok, details };
}

function checkManifests(
  packages: Array<{ dir: string; pkg: PackageJson }>,
): CheckResult {
  const details: string[] = [];
  let ok = true;

  for (const { pkg } of packages) {
    if (!pkg.name || !pkg.quartz) continue;
    const manifest = pkg.quartz as Record<string, unknown>;
    const missing: string[] = [];
    if (!manifest.name) missing.push("name");
    if (!manifest.category) missing.push("category");
    if (!manifest.quartzVersion) missing.push("quartzVersion");
    if (missing.length > 0) {
      ok = false;
      details.push(
        `${pkg.name}: missing quartz fields (${missing.join(", ")})`,
      );
    }
  }

  return { name: "Manifests", ok, details };
}

function checkEngines(
  packages: Array<{ dir: string; pkg: PackageJson }>,
): CheckResult {
  const current = parseVersion(process.version);
  const details: string[] = [];
  let ok = true;

  for (const { pkg } of packages) {
    if (!pkg.name) continue;
    const range = pkg.engines?.node;
    if (!range) {
      ok = false;
      details.push(`${pkg.name}: missing engines.node`);
      continue;
    }
    if (!satisfiesRange(current, range)) {
      ok = false;
      details.push(
        `${pkg.name}: engines.node ${range} does not satisfy ${process.version}`,
      );
    }
  }

  return { name: "Engines", ok, details };
}

function formatResults(results: CheckResult[], asJson: boolean): void {
  const overall = results.every((result) => result.ok);
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: overall,
          results,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(`${status}: ${result.name}`);
    if (!result.ok) {
      for (const detail of result.details) {
        console.log(`  - ${detail}`);
      }
    }
  }
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has("--json");

  const workspacePackages = getWorkspacePackages();
  if (workspacePackages.length === 0) {
    console.error("No workspace packages found in repos/. Run 'just setup' to clone workspace packages.");
    process.exit(1);
  }

  const results = [
    checkSingletons(),
    checkOverrides(workspacePackages),
    checkManifests(workspacePackages),
    checkEngines(workspacePackages),
  ];

  formatResults(results, asJson);

  if (results.some((result) => !result.ok)) {
    console.error("Workspace validation failed.");
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
