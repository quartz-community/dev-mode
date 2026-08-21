import { execSync } from "node:child_process";

interface Requirement {
  command: string;
  versionFlag: string;
  versionRegex: RegExp;
  minMajor: number;
  name: string;
  installHint: string;
}

const requirements: Requirement[] = [
  {
    command: "node",
    versionFlag: "--version",
    versionRegex: /v(\d+)\./,
    minMajor: 22,
    name: "Node.js",
    installHint: "Install via https://nodejs.org or use 'nix develop'",
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
    if (major < req.minMajor) {
      console.error(
        `x ${req.name} ${req.minMajor}+ required, found ${version}`,
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
