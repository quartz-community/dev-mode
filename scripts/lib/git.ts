import { execSync } from "node:child_process";

export function getDefaultBranch(ghRepo: string): string | undefined {
  try {
    const output = execSync(
      `git ls-remote --symref https://github.com/${ghRepo}.git HEAD`,
      {
        encoding: "utf-8",
        timeout: 15_000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const match = output.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}
