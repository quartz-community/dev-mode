import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runCommandCapture, TIMEOUTS } from "./exec.js";

export interface CleanRoomCheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

function copyManifestFiles(source: string, destination: string): void {
  copyFileSync(join(source, "package.json"), join(destination, "package.json"));
  const npmrc = join(source, ".npmrc");
  if (existsSync(npmrc)) copyFileSync(npmrc, join(destination, ".npmrc"));
}

function failure(
  name: string,
  command: string,
  error: unknown,
): CleanRoomCheckResult {
  return {
    name,
    ok: false,
    details: [
      `${command} failed: ${error instanceof Error ? error.message : String(error)}`,
    ],
  };
}

export async function checkCleanRoomInstall(
  targetDir: string,
): Promise<CleanRoomCheckResult[]> {
  const targetName = basename(targetDir);
  const committedName = `Committed lockfile installs (${targetName})`;
  const regeneratedName = `Package.json regenerates and installs (${targetName})`;
  const packagePath = join(targetDir, "package.json");
  const lockfilePath = join(targetDir, "package-lock.json");
  if (!existsSync(packagePath)) {
    const detail = `missing package.json in ${targetDir}`;
    return [
      { name: committedName, ok: false, details: [detail] },
      { name: regeneratedName, ok: false, details: [detail] },
    ];
  }

  const committedDir = mkdtempSync(join(tmpdir(), "quartz-doctor-committed-"));
  const regenerateDir = mkdtempSync(
    join(tmpdir(), "quartz-doctor-regenerate-"),
  );
  const regeneratedCiDir = mkdtempSync(
    join(tmpdir(), "quartz-doctor-regenerated-ci-"),
  );
  try {
    let committedResult: CleanRoomCheckResult;
    if (!existsSync(lockfilePath)) {
      committedResult = {
        name: committedName,
        ok: false,
        details: [`missing package-lock.json in ${targetDir}`],
      };
    } else {
      copyManifestFiles(targetDir, committedDir);
      copyFileSync(lockfilePath, join(committedDir, "package-lock.json"));
      try {
        await runCommandCapture(
          "npm",
          ["ci", "--ignore-scripts"],
          committedDir,
          false,
          { timeout: TIMEOUTS.NPM_INSTALL },
        );
        committedResult = { name: committedName, ok: true, details: [] };
      } catch (error) {
        committedResult = failure(
          committedName,
          "npm ci --ignore-scripts",
          error,
        );
      }
    }

    let regeneratedResult: CleanRoomCheckResult;
    copyManifestFiles(targetDir, regenerateDir);
    try {
      await runCommandCapture(
        "npm",
        ["install", "--ignore-scripts", "--package-lock-only"],
        regenerateDir,
        false,
        { timeout: TIMEOUTS.NPM_INSTALL },
      );
      copyManifestFiles(targetDir, regeneratedCiDir);
      copyFileSync(
        join(regenerateDir, "package-lock.json"),
        join(regeneratedCiDir, "package-lock.json"),
      );
      await runCommandCapture(
        "npm",
        ["ci", "--ignore-scripts", "--dry-run"],
        regeneratedCiDir,
        false,
        { timeout: TIMEOUTS.NPM_INSTALL },
      );
      regeneratedResult = { name: regeneratedName, ok: true, details: [] };
    } catch (error) {
      regeneratedResult = failure(
        regeneratedName,
        "npm install --ignore-scripts --package-lock-only / npm ci --ignore-scripts --dry-run",
        error,
      );
    }

    return [committedResult, regeneratedResult];
  } finally {
    rmSync(committedDir, { recursive: true, force: true });
    rmSync(regenerateDir, { recursive: true, force: true });
    rmSync(regeneratedCiDir, { recursive: true, force: true });
  }
}
