import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "repos");
const TURBO_JSON = join(ROOT, "turbo.json");

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  return JSON.parse(readFileSync(pkgPath, "utf-8"));
}

export function generate(): void {
  if (!existsSync(REPOS_DIR)) {
    console.log("No repos/ directory — skipping turbo graph generation");
    return;
  }

  const repoDirs = readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const workspacePackageNames = new Set<string>();
  for (const dir of repoDirs) {
    const pkg = readPackageJson(join(REPOS_DIR, dir));
    if (pkg?.name) workspacePackageNames.add(pkg.name);
  }

  const packageDeps = new Map<string, string[]>();

  for (const dir of repoDirs) {
    const pkg = readPackageJson(join(REPOS_DIR, dir));
    if (!pkg?.name) continue;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const workspaceDeps: string[] = [];
    for (const depName of Object.keys(allDeps)) {
      if (depName !== pkg.name && workspacePackageNames.has(depName)) {
        workspaceDeps.push(depName);
      }
    }

    if (workspaceDeps.length > 0) {
      packageDeps.set(pkg.name, workspaceDeps);
    }
  }

  const turboJson = JSON.parse(readFileSync(TURBO_JSON, "utf-8"));

  for (const key of Object.keys(turboJson.tasks)) {
    if (key.includes("#")) {
      delete turboJson.tasks[key];
    }
  }

  for (const [pkgName, deps] of packageDeps) {
    turboJson.tasks[`${pkgName}#build`] = {
      dependsOn: deps.map((d) => `${d}#build`),
    };
  }

  writeFileSync(TURBO_JSON, JSON.stringify(turboJson, null, 2) + "\n");

  const entryCount = packageDeps.size;
  const totalDeps = [...packageDeps.values()].reduce(
    (sum, d) => sum + d.length,
    0,
  );
  console.log(
    `Generated turbo dependency graph: ${entryCount} packages, ${totalDeps} edges`,
  );
  for (const [pkg, deps] of packageDeps) {
    console.log(`  ${pkg} → ${deps.join(", ")}`);
  }
}

generate();
