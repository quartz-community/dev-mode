import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareSemver, parseVersion } from "./lib/semver.js";

interface Requirement {
  command: string;
  versionFlag: string;
  versionRegex: RegExp;
  minMajor: number;
  /** Exact minimum (x.y.z), checked in addition to minMajor. */
  minVersion?: string;
  name: string;
  installHint: string;
}

// The workspace pins Node in .node-version (also used by the Nix flake, fnm/nvm/Volta and CI).
const nodeVersion = readFileSync(
  join(import.meta.dirname, "..", ".node-version"),
  "utf-8",
).trim();

const requirements: Requirement[] = [
  {
    command: "node",
    versionFlag: "--version",
    versionRegex: /v(\d+)\./,
    minMajor: 22,
    minVersion: nodeVersion,
    name: "Node.js",
    installHint: `Install Node ${nodeVersion} (see .node-version) via https://nodejs.org, fnm/nvm/volta, or use 'nix develop'`,
  },
  {
    command: "pnpm",
    versionFlag: "--version",
    versionRegex: /^(\d+)\./,
    minMajor: 10,
    name: "pnpm",
    installHint:
      "Install via 'corepack enable && corepack prepare pnpm@latest --activate'",
  },
  {
    command: "git",
    versionFlag: "--version",
    versionRegex: /(\d+)\./,
    minMajor: 2,
    name: "git",
    installHint: "Install via your system package manager",
  },
];

let failed = false;

for (const req of requirements) {
  try {
    const version = execSync(`${req.command} ${req.versionFlag}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
    const match = version.match(req.versionRegex);
    const major = match ? Number(match[1]) : 0;
    const tooOld =
      major < req.minMajor ||
      (req.minVersion !== undefined &&
        compareSemver(
          parseVersion(version.replace(/^v/, "")),
          parseVersion(req.minVersion),
        ) < 0);
    if (tooOld) {
      console.error(
        `x ${req.name} ${req.minVersion ?? `${req.minMajor}+`} or newer required, found ${version}`,
      );
      console.error(`  ${req.installHint}`);
      failed = true;
    } else {
      console.log(`ok ${req.name} ${version}`);
    }
  } catch {
    console.error(`x ${req.name} not found`);
    console.error(`  ${req.installHint}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
