import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const QUARTZ_DIR = path.join(ROOT, "repos/quartz");
const QUARTZ_CONFIG = path.join(QUARTZ_DIR, "quartz.config.yaml");
const FIXTURES_DIR = path.join(ROOT, "e2e/fixtures");
const OUTPUT_DIR = path.join(ROOT, "e2e/.output");
const BUILD_TIMEOUT_MS = 120_000;

const fixtureName = process.argv[2];
if (!fixtureName) {
  console.error("Usage: tsx e2e/helpers/build-fixture.ts <fixture-name>");
  process.exit(1);
}

const fixtureDir = path.join(FIXTURES_DIR, fixtureName);
const fixtureConfig = path.join(fixtureDir, "quartz.config.yaml");
const fixtureContent = path.join(fixtureDir, "content");

if (!fs.existsSync(fixtureConfig)) {
  console.error(`Fixture config not found: ${fixtureConfig}`);
  process.exit(1);
}

if (!fs.existsSync(fixtureContent)) {
  console.error(`Fixture content not found: ${fixtureContent}`);
  process.exit(1);
}

if (fs.existsSync(QUARTZ_CONFIG)) {
  console.error(
    `Pre-existing quartz.config.yaml found at ${QUARTZ_CONFIG}.\n` +
      "This indicates a previous interrupted build or concurrent 'just serve'.\n" +
      "Remove it manually and retry.",
  );
  process.exit(1);
}

const outputDir = path.join(OUTPUT_DIR, fixtureName);
const quartzPublic = path.join(QUARTZ_DIR, "public");

if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true });
}

const contentRelative = path.relative(QUARTZ_DIR, fixtureContent);

try {
  fs.copyFileSync(fixtureConfig, QUARTZ_CONFIG);

  console.log(
    "Running install-plugins (generates .quartz/plugins manifest)...",
  );
  execSync("npx tsx ./quartz/plugins/loader/install-plugins.ts", {
    cwd: QUARTZ_DIR,
    stdio: "inherit",
    timeout: BUILD_TIMEOUT_MS,
  });

  console.log(`Building fixture "${fixtureName}"...`);
  execSync(`node quartz/bootstrap-cli.mjs build -d ${contentRelative}`, {
    cwd: QUARTZ_DIR,
    stdio: "inherit",
    timeout: BUILD_TIMEOUT_MS,
  });

  if (!fs.existsSync(quartzPublic)) {
    throw new Error(`Build produced no output at ${quartzPublic}`);
  }

  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.renameSync(quartzPublic, outputDir);
  console.log(`Fixture "${fixtureName}" built to ${outputDir}`);
} finally {
  if (fs.existsSync(QUARTZ_CONFIG)) {
    fs.unlinkSync(QUARTZ_CONFIG);
  }
  if (fs.existsSync(quartzPublic)) {
    fs.rmSync(quartzPublic, { recursive: true });
  }
}
