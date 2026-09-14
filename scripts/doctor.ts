import { resolve } from "node:path";
import { checkCleanRoomInstall } from "./lib/cleanroom.js";
import { safeReadJson } from "./lib/json.js";
import { analyzeLockfile, type PackageLock } from "./lib/lockfile.js";
import { checkRegistryReachability } from "./lib/registry.js";

type CheckResult = {
  name: string;
  ok: boolean;
  details: string[];
};

const ROOT = resolve(import.meta.dirname, "..");

function formatResults(results: CheckResult[], asJson: boolean): void {
  const overall = results.every((result) => result.ok);
  if (asJson) {
    console.log(JSON.stringify({ ok: overall, results }, null, 2));
    return;
  }

  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(`${status}: ${result.name}`);
    for (const detail of result.details) console.log(`  - ${detail}`);
  }
}

function optionValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? resolve(ROOT, process.argv[index + 1])
    : fallback;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has("--json");
  const skipNetwork = args.has("--skip-network");
  const integrityOnly = args.has("--integrity-only");
  const targetDir = optionValue("--target", resolve(ROOT, "repos/quartz"));
  const lockfilePath = optionValue(
    "--lockfile",
    resolve(targetDir, "package-lock.json"),
  );

  const lockfile = safeReadJson<PackageLock>(lockfilePath);
  const results: CheckResult[] = [];
  if (!skipNetwork) results.push(await checkRegistryReachability(ROOT));
  results.push(analyzeLockfile(lockfile, integrityOnly));
  if (!skipNetwork) results.push(await checkCleanRoomInstall(targetDir));

  formatResults(results, asJson);
  if (results.some((result) => !result.ok)) process.exit(1);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
