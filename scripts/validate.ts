import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

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

type Semver = { major: number; minor: number; patch: number };

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readPackageJson(dir: string): PackageJson | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  return readJson<PackageJson>(pkgPath);
}

function parseVersion(raw: string): Semver {
  const clean = raw.startsWith("v") ? raw.slice(1) : raw;
  const [major, minor, patch] = clean.split(".").map((part) => Number(part));
  return {
    major: Number.isFinite(major) ? major : 0,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0,
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function bumpMajor(v: Semver): Semver {
  return { major: v.major + 1, minor: 0, patch: 0 };
}

function bumpMinor(v: Semver): Semver {
  return { major: v.major, minor: v.minor + 1, patch: 0 };
}

function parsePartialVersion(input: string): Semver | null {
  const parts = input.split(".");
  const major = Number(parts[0]);
  if (!Number.isFinite(major)) return null;
  const minor = parts.length > 1 ? Number(parts[1]) : 0;
  const patch = parts.length > 2 ? Number(parts[2]) : 0;
  return {
    major,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0,
  };
}

function expandToken(
  token: string,
): Array<{ op: ">" | ">=" | "<" | "<=" | "="; version: Semver }> {
  if (!token || token === "*") return [];

  if (token.startsWith("^")) {
    const base = parsePartialVersion(token.slice(1));
    if (!base) return [];
    return [
      { op: ">=", version: base },
      { op: "<", version: bumpMajor(base) },
    ];
  }

  if (token.startsWith("~")) {
    const base = parsePartialVersion(token.slice(1));
    if (!base) return [];
    return [
      { op: ">=", version: base },
      { op: "<", version: bumpMinor(base) },
    ];
  }

  if (token.includes("x") || token.includes("*")) {
    const clean = token.replace(/\*/g, "x");
    const parts = clean.split(".");
    const major = Number(parts[0]);
    if (!Number.isFinite(major)) return [];
    if (parts.length === 1 || parts[1] === "x") {
      return [
        { op: ">=", version: { major, minor: 0, patch: 0 } },
        { op: "<", version: { major: major + 1, minor: 0, patch: 0 } },
      ];
    }
    const minor = Number(parts[1]);
    if (!Number.isFinite(minor)) return [];
    return [
      { op: ">=", version: { major, minor, patch: 0 } },
      { op: "<", version: { major, minor: minor + 1, patch: 0 } },
    ];
  }

  const match = token.match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})$/);
  if (!match) return [];
  const op = (match[1] as ">" | ">=" | "<" | "<=" | "=") ?? "=";
  const version = parsePartialVersion(match[2]);
  if (!version) return [];
  return [{ op, version }];
}

function satisfiesComparator(
  current: Semver,
  comparator: { op: ">" | ">=" | "<" | "<=" | "="; version: Semver },
): boolean {
  const cmp = compareSemver(current, comparator.version);
  switch (comparator.op) {
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case "=":
    default:
      return cmp === 0;
  }
}

function satisfiesRange(current: Semver, range: string): boolean {
  const trimmed = range.trim();
  if (!trimmed || trimmed === "*") return true;

  const orParts = trimmed
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of orParts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    let ok = true;
    for (const token of tokens) {
      const comparators = expandToken(token);
      for (const comparator of comparators) {
        if (!satisfiesComparator(current, comparator)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) return true;
  }
  return false;
}

function runCommand(command: string): { output: string; error?: string } {
  try {
    const output = execSync(command, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
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
  const deps = ["preact", "unified", "vfile"];
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
    console.error("No workspace packages found in repos/.");
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
