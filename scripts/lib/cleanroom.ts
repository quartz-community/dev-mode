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

export async function checkCleanRoomInstall(
  targetDir: string,
): Promise<CleanRoomCheckResult> {
  const name = `Clean-room install (${basename(targetDir)})`;
  if (!existsSync(join(targetDir, "package.json"))) {
    return {
      name,
      ok: false,
      details: [`missing package.json in ${targetDir}`],
    };
  }

  const installDir = mkdtempSync(join(tmpdir(), "quartz-doctor-install-"));
  const ciDir = mkdtempSync(join(tmpdir(), "quartz-doctor-ci-"));
  try {
    copyManifestFiles(targetDir, installDir);
    try {
      await runCommandCapture(
        "npm",
        ["install", "--ignore-scripts", "--package-lock-only"],
        installDir,
        false,
        { timeout: TIMEOUTS.NPM_INSTALL },
      );
    } catch (error) {
      return {
        name,
        ok: false,
        details: [
          `npm install --ignore-scripts --package-lock-only failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }

    copyManifestFiles(targetDir, ciDir);
    copyFileSync(
      join(installDir, "package-lock.json"),
      join(ciDir, "package-lock.json"),
    );
    try {
      await runCommandCapture(
        "npm",
        ["ci", "--ignore-scripts", "--dry-run"],
        ciDir,
        false,
        { timeout: TIMEOUTS.NPM_INSTALL },
      );
    } catch (error) {
      return {
        name,
        ok: false,
        details: [
          `npm ci --ignore-scripts --dry-run failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }

    return { name, ok: true, details: [] };
  } finally {
    rmSync(installDir, { recursive: true, force: true });
    rmSync(ciDir, { recursive: true, force: true });
  }
}
