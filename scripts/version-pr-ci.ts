/**
 * Roll out CI for changesets version PRs (see scripts/lib/version-pr-ci.ts).
 *
 *   just version-pr-ci [repo…]            commit the change on a local `dev-mode/version-pr-ci`
 *                                          branch per repo, from origin's default branch, without
 *                                          touching working trees (git plumbing)
 *   just version-pr-ci --push [repo…]     also push those branches and open PRs (outward-facing)
 *   --dry-run                              only report what would change
 *   --force                                replace an existing local dev-mode/version-pr-ci branch
 *
 * Repos whose workflows don't have the expected shape are listed as "manual" and left alone.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "./lib/args.js";
import { TIMEOUTS } from "./lib/exec.js";
import { logError } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";
import {
  patchCiWorkflow,
  patchReleaseWorkflow,
  STATUS_CONTEXT,
  type PatchResult,
} from "./lib/version-pr-ci.js";

const ROOT = resolve(import.meta.dirname, "..");
const BRANCH = "dev-mode/version-pr-ci";
const CI = ".github/workflows/ci.yml";
const RELEASE = ".github/workflows/release.yml";
const MESSAGE =
  "ci: run ci.yml on the changesets version PR and report it as a commit status";
const PR_BODY = `changesets/action pushes the version PR with \`GITHUB_TOKEN\`, which triggers no workflows, so version PRs show no checks and the lockfile \`version-packages\` rewrote is never tested before it's published.

This makes \`ci.yml\` callable (\`workflow_call\`, checking out a given commit) and adds to \`release.yml\`:
- a pending \`${STATUS_CONTEXT}\` commit status on the version PR's head,
- a job running \`ci.yml\` on that commit,
- a job reporting its result as that status.

Publishing is unchanged. Once this has run on a version PR, \`${STATUS_CONTEXT}\` can be made a required check.`;

function git(
  cwd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; input?: string; allowFail?: boolean } = {},
): string {
  const res = spawnSync("git", args, {
    cwd,
    env: { ...process.env, ...opts.env },
    input: opts.input,
    encoding: "utf-8",
    timeout: TIMEOUTS.GIT_OP,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    if (opts.allowFail) return "";
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${res.stderr.trim()}`,
    );
  }
  return res.stdout.trim();
}

function defaultBranch(repo: string): string {
  const head = git(repo, ["rev-parse", "--abbrev-ref", "origin/HEAD"], {
    allowFail: true,
  });
  // origin/HEAD can be stale (quartz-themes-core pointed at a deleted master): verify it exists
  if (
    head &&
    git(repo, ["rev-parse", "-q", "--verify", head], { allowFail: true })
  )
    return head;
  for (const b of ["origin/main", "origin/master"]) {
    if (git(repo, ["rev-parse", "-q", "--verify", b], { allowFail: true }))
      return b;
  }
  throw new Error(`no default branch found in ${repo}`);
}

interface Outcome {
  repo: string;
  result: "committed" | "would commit" | "up to date" | "manual" | "skipped";
  detail: string;
}

/** Commit the patched files onto `base` as BRANCH without touching the working tree or index. */
function commitPatched(
  repo: string,
  base: string,
  files: Record<string, string>,
): string {
  const indexFile = join(repo, ".git", "version-pr-ci.index");
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    git(repo, ["read-tree", base], { env });
    for (const [path, text] of Object.entries(files)) {
      const blob = git(repo, ["hash-object", "-w", "--stdin"], { input: text });
      git(repo, ["update-index", "--cacheinfo", `100644,${blob},${path}`], {
        env,
      });
    }
    const tree = git(repo, ["write-tree"], { env });
    const commit = git(repo, ["commit-tree", tree, "-p", base, "-m", MESSAGE]);
    git(repo, ["update-ref", `refs/heads/${BRANCH}`, commit]);
    return commit;
  } finally {
    spawnSync("rm", ["-f", indexFile], { timeout: TIMEOUTS.GIT_OP });
  }
}

function processRepo(
  name: string,
  opts: { dryRun: boolean; force: boolean; fetch: boolean },
): Outcome {
  const repo = join(ROOT, "repos", name);
  if (!existsSync(join(repo, ".git")))
    return { repo: name, result: "skipped", detail: "not cloned" };
  if (opts.fetch) git(repo, ["fetch", "-q", "origin"], { allowFail: true });
  const base = defaultBranch(repo);
  const read = (path: string) =>
    git(repo, ["show", `${base}:${path}`], { allowFail: true });
  const release = read(RELEASE);
  if (!release.includes("changesets/action")) {
    return {
      repo: name,
      result: "skipped",
      detail: `no changesets release.yml on ${base}`,
    };
  }
  const ci = read(CI);
  if (!ci)
    return { repo: name, result: "manual", detail: `no ${CI} on ${base}` };

  // git show trims the trailing newline; workflows end with one
  const results: [string, PatchResult][] = [
    [CI, patchCiWorkflow(`${ci}\n`)],
    [RELEASE, patchReleaseWorkflow(`${release}\n`)],
  ];
  const manual = results.filter(([, r]) => r.status === "manual");
  if (manual.length > 0) {
    return {
      repo: name,
      result: "manual",
      detail: manual
        .map(([p, r]) => `${p}: ${r.status === "manual" ? r.reason : ""}`)
        .join("; "),
    };
  }
  const files: Record<string, string> = {};
  for (const [path, r] of results)
    if (r.status === "patched") files[path] = r.text;
  if (Object.keys(files).length === 0) {
    return { repo: name, result: "up to date", detail: `already on ${base}` };
  }
  if (opts.dryRun) {
    return {
      repo: name,
      result: "would commit",
      detail: Object.keys(files).join(", "),
    };
  }
  const existing = git(
    repo,
    ["rev-parse", "-q", "--verify", `refs/heads/${BRANCH}`],
    {
      allowFail: true,
    },
  );
  if (existing && !opts.force) {
    return {
      repo: name,
      result: "skipped",
      detail: `${BRANCH} exists (--force replaces it)`,
    };
  }
  if (existing && git(repo, ["branch", "--show-current"]) === BRANCH) {
    return {
      repo: name,
      result: "skipped",
      detail: `${BRANCH} is checked out`,
    };
  }
  const commit = commitPatched(repo, base, files);
  return {
    repo: name,
    result: "committed",
    detail: `${commit.slice(0, 7)} on ${base}`,
  };
}

function pushAndOpenPr(name: string): string {
  const repo = join(ROOT, "repos", name);
  git(repo, ["push", "-u", "origin", `${BRANCH}:${BRANCH}`]);
  const base = defaultBranch(repo).replace(/^origin\//, "");
  const res = spawnSync(
    "gh",
    [
      "pr",
      "create",
      "--head",
      BRANCH,
      "--base",
      base,
      "--title",
      MESSAGE,
      "--body",
      PR_BODY,
    ],
    { cwd: repo, encoding: "utf-8", timeout: 60_000 },
  );
  if (res.status !== 0)
    throw new Error(`gh pr create failed for ${name}: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  // all flags are boolean: parseArgs reads `--push note-properties` as push="note-properties"
  const positionals = [...positional];
  for (const key of ["dry-run", "push", "force", "no-fetch"]) {
    if (typeof flags[key] === "string") positionals.push(flags[key] as string);
  }
  const dryRun = Boolean(flags["dry-run"]);
  const push = Boolean(flags.push);
  const manifest = readManifest();
  const all = [
    ...manifest.infrastructure.map((e) => e.name ?? e.repo.split("/").pop()!),
    ...manifest.plugins.map((e) => e.name),
  ];
  const selected = positionals.length > 0 ? positionals : all;

  const outcomes = selected.map((name) =>
    processRepo(name, {
      dryRun,
      force: Boolean(flags.force),
      fetch: !flags["no-fetch"],
    }),
  );
  const width = Math.max(...outcomes.map((o) => o.repo.length), 4);
  for (const o of outcomes)
    console.log(`${o.repo.padEnd(width)}  ${o.result.padEnd(12)}  ${o.detail}`);

  if (push && !dryRun) {
    for (const o of outcomes.filter((x) => x.result === "committed")) {
      console.log(`${o.repo}: ${pushAndOpenPr(o.repo)}`);
    }
  } else if (outcomes.some((o) => o.result === "committed")) {
    console.log(
      `\nLocal branches only. Review with \`git -C repos/<repo> show ${BRANCH}\`; --push pushes them and opens PRs.`,
    );
  }
  if (outcomes.some((o) => o.result === "manual")) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
