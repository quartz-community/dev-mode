/**
 * Build E2E fixtures into e2e/.output/<fixture> (served by serve-fixture.ts).
 *
 *   tsx e2e/helpers/build-fixture.ts <fixture> [<fixture>...]
 *   tsx e2e/helpers/build-fixture.ts all
 *
 * Builds run in isolated sandboxes (scripts/lib/sandbox.ts), so they never
 * touch repos/quartz (no quartz.config.yaml / public/ clobbering) and several
 * fixtures can build in parallel.
 */
import * as path from "node:path";
import { buildSite, loadConfig, rel } from "../../scripts/lib/sandbox.js";
import {
  formatStaleDists,
  listFixtures,
  FIXTURES_DIR,
} from "../../scripts/lib/site-target.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_DIR = path.join(ROOT, "e2e/.output");

async function buildFixture(name: string): Promise<boolean> {
  const fixtureDir = path.join(FIXTURES_DIR, name);
  const config = loadConfig(path.join(fixtureDir, "quartz.config.yaml"));
  const result = await buildSite({
    name: `e2e-${name}`,
    config,
    contentDir: path.join(fixtureDir, "content"),
    outDir: path.join(OUTPUT_DIR, name),
  });
  if (!result.ok) {
    console.error(`✗ Fixture "${name}" failed (log: ${rel(result.logPath)})`);
    console.error(result.log.split("\n").slice(-30).join("\n"));
    return false;
  }
  console.log(
    `✓ Fixture "${name}" built in ${(result.durationMs / 1000).toFixed(1)}s → ${rel(result.outDir)}`,
  );
  for (const line of formatStaleDists(result)) console.log(`  ${line}`);
  for (const e of result.errors) console.log(`  ${e}`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      `Usage: tsx e2e/helpers/build-fixture.ts <fixture...|all>\nFixtures: ${listFixtures().join(", ")}`,
    );
    process.exit(1);
  }
  const names = args.includes("all") ? listFixtures() : args;
  const unknown = names.filter((n) => !listFixtures().includes(n));
  if (unknown.length) {
    console.error(
      `Unknown fixture(s): ${unknown.join(", ")}. Available: ${listFixtures().join(", ")}`,
    );
    process.exit(1);
  }
  const results = await Promise.all(names.map(buildFixture));
  if (results.some((ok) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
