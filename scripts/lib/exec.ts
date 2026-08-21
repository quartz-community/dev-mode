import { spawn } from "node:child_process";
import { logInfo } from "./log.js";

export const TIMEOUTS = {
  GIT_CLONE: 60_000,
  GIT_OP: 10_000,
  PNPM_INSTALL: 600_000,
  TURBO_BUILD: 900_000,
} as const;

export interface ExecOptions {
  timeout?: number;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  dryRun: boolean,
  options?: ExecOptions,
): Promise<void> {
  if (dryRun) {
    logInfo("dry-run", { command, args, cwd });
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    let killed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
      }, options.timeout);
    }
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        rejectPromise(
          new Error(
            `Command timed out after ${options!.timeout}ms: ${command} ${args.join(
              " ",
            )}`,
          ),
        );
        return;
      }
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Command failed (${command} ${args.join(" ")})`));
    });
  });
}

export async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
  dryRun: boolean,
  options?: ExecOptions,
): Promise<string> {
  if (dryRun) {
    logInfo("dry-run", { command, args, cwd });
    return "";
  }

  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
      }, options.timeout);
    }
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        rejectPromise(
          new Error(
            `Command timed out after ${options!.timeout}ms: ${command} ${args.join(
              " ",
            )}`,
          ),
        );
        return;
      }
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }
      rejectPromise(
        new Error(stderr.trim() || `Command failed (${command} ${args.join(" ")})`),
      );
    });
  });
}
