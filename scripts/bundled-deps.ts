/**
 * Stale bundled dependencies: plugins bundle every dependency at build time
 * (tsup `noExternal: [/.*\/]`) at the version their own package-lock.json
 * pins, so a fix released in utils / rehype-obsidian / remark-obsidian
 * reaches users only after each plugin bumps its lockfile and releases.
 *
 *   bundled-deps [repo...] [--published] [--fail-on stale|any] [--deps <glob,...>]
 *                [--remote] [--no-fetch] [--no-affected] [--all] [--markdown] [--json]
 *
 * Rows (one per installed copy of each @quartz-community / @quartz-themes
 * package, plus --deps):
 *   main  the lockfile on the repo's default branch: what the next release bundles
 *   npm   (--published) the tarball of the version Quartz core installs
 *
 * Exit: 1 with --fail-on when a row fails (stale; `any` also counts
 * stale-unaffected) or a lookup errored; else 0.
 */
import { join, resolve } from "node:path";
import { parseArgs } from "./lib/args.js";
import {
  collectBundledDeps,
  isFailing,
  summarize,
  type BundledDep,
  type FailOn,
} from "./lib/bundled-deps/index.js";
import { logError } from "./lib/log.js";
import { readManifest } from "./lib/manifest.js";

const ROOT = resolve(import.meta.dirname, "..");
const BOOLEAN_FLAGS = [
  "json",
  "published",
  "remote",
  "no-affected",
  "no-fetch",
  "all",
  "markdown",
  "help",
];

const USAGE = `Usage: just bundled-deps [repo...] [--published] [--fail-on stale|any] [--deps <glob,...>] [--remote] [--no-fetch] [--no-affected] [--all] [--markdown] [--json]

Which @quartz-community/@quartz-themes packages each plugin bundles, at which version, vs npm latest.
  (default)       the package-lock.json on each repo's default branch (= the next release)
  --published     also the published tarball Quartz core installs (source maps + the release's lockfile)
  --fail-on stale exit 1 if a bundled copy is older than latest and its bundled files changed
  --fail-on any   ... or older at all (stale-unaffected too)
  --deps a,b*     also track these packages
  --remote        read repo files from GitHub instead of local clones (used in CI)
  --no-fetch      don't \`git fetch\` local clones first (their origin refs may be behind)
  --no-affected   skip downloading dependency tarballs (no stale-unaffected detection)
  --all           list current / types-only / external rows too`;

const VISIBLE = new Set(["stale", "stale-unaffected", "unknown", "ahead"]);

function table(
  headers: string[],
  rows: string[][],
  markdown: boolean,
): string[] {
  if (markdown) {
    const line = (cells: string[]) =>
      `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
    return [line(headers), line(headers.map(() => "---")), ...rows.map(line)];
  }
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, index) => (cell ?? "").padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  return [
    format(headers),
    format(widths.map((width) => "-".repeat(width))),
    ...rows.map(format),
  ];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function statusCell(row: BundledDep): string {
  if (row.status === "stale") return `STALE (${row.level ?? "?"})`;
  if (row.status === "stale-unaffected")
    return `stale-unaffected (${row.level ?? "?"})`;
  return row.status;
}

function shortPath(row: BundledDep): string {
  if (!row.path) return "";
  const nested = row.path.split("node_modules/").length - 1 > 1;
  return nested
    ? ` via ${row.path.replace(/^node_modules\//, "").replace(/\/node_modules\/.*$/, "")}`
    : "";
}

async function main(): Promise<number> {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const args = [...positional];
  for (const flag of BOOLEAN_FLAGS) {
    if (typeof flags[flag] === "string") {
      args.push(flags[flag] as string);
      flags[flag] = true;
    }
  }
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  let failOn: FailOn | undefined;
  if (flags["fail-on"] !== undefined) {
    if (flags["fail-on"] !== "stale" && flags["fail-on"] !== "any") {
      console.error(`--fail-on must be stale or any\n\n${USAGE}`);
      return 2;
    }
    failOn = flags["fail-on"];
  }
  const extraDeps =
    typeof flags.deps === "string"
      ? flags.deps
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
      : [];
  const markdown = Boolean(flags.markdown);

  const { repos, unknown } = await collectBundledDeps({
    reposDir: join(ROOT, "repos"),
    cacheDir: join(ROOT, ".dev", "cache", "npm-tarballs"),
    manifest: readManifest(),
    queries: args,
    published: Boolean(flags.published),
    remote: Boolean(flags.remote),
    extraDeps,
    affected: !flags["no-affected"],
    fetch: !flags["no-fetch"],
  });
  if (unknown.length) {
    console.error(`unknown repo(s): ${unknown.join(", ")}\n\n${USAGE}`);
    return 2;
  }

  const rows = repos.flatMap((repo) => repo.rows);
  const counts = summarize(rows);
  const failing = failOn ? rows.filter((row) => isFailing(row, failOn)) : [];
  const errors = repos.flatMap((repo) =>
    repo.errors.map((error) => `${repo.repo}: ${error}`),
  );
  const exitCode = failOn && (failing.length > 0 || errors.length > 0) ? 1 : 0;

  if (flags.json) {
    console.log(
      JSON.stringify(
        { repos, summary: counts, failOn, failing, errors },
        null,
        2,
      ),
    );
    return exitCode;
  }

  const shown = flags.all
    ? rows
    : rows.filter((row) => VISIBLE.has(row.status));
  const out: string[] = [];
  if (shown.length) {
    out.push(
      ...table(
        [
          "Repo",
          "Source",
          "Bundled dependency",
          "Bundled",
          "Latest",
          "Workspace",
          "Status",
        ],
        shown.map((row) => [
          row.repo,
          row.source === "npm" ? `npm ${row.sourceVersion}` : "main",
          `${row.dependency}${shortPath(row)}`,
          row.version ?? "?",
          row.latest ?? "?",
          row.workspace ?? "-",
          statusCell(row),
        ]),
        markdown,
      ),
      "",
    );
  }

  const stale = rows.filter((row) => row.status === "stale");
  if (stale.length) {
    const bullet = markdown ? "- " : "  ";
    out.push(
      markdown
        ? "### Stale bundled copies"
        : "Stale bundled copies (bundled code differs from latest):",
    );
    for (const row of stale) {
      const where = row.source === "npm" ? `npm ${row.sourceVersion}` : "main";
      const what = row.changedSymbols?.length
        ? `uses changed ${truncate(row.changedSymbols.join(", "), 120)}`
        : row.changedFiles?.length
          ? `bundled files changed: ${row.changedFiles.join(", ")}`
          : "bundled files unknown";
      out.push(
        `${bullet}${row.repo} (${where}): ${row.dependency} ${row.version} → ${row.latest} (${row.level}); ${what}${row.note ? ` [${row.note}]` : ""}`,
      );
    }
    // What the stale copies miss, once per dependency (from the oldest bundled copy).
    const byDependency = new Map<string, BundledDep>();
    for (const row of stale) {
      const seen = byDependency.get(row.dependency);
      if (
        row.changelog?.length &&
        (!seen || (seen.changelog?.length ?? 0) < row.changelog.length)
      )
        byDependency.set(row.dependency, row);
    }
    if (byDependency.size) {
      out.push(
        "",
        markdown ? "### Missed changes" : "Missed changes (CHANGELOG):",
      );
      for (const [dependency, row] of byDependency) {
        out.push(`${bullet}${dependency} (since ${row.version}):`);
        for (const entry of row.changelog ?? [])
          out.push(
            `${markdown ? "  - " : "      "}${entry.version}: ${truncate(entry.lines[0] ?? "(no entries)", 110)}${entry.lines.length > 1 ? ` (+${entry.lines.length - 1})` : ""}`,
          );
      }
    }
    out.push(
      "",
      "Fix: in each repo `npm update <dep> --package-lock-only` (inside nix develop; edit the range first for a major), add a patch changeset, release.",
      "",
    );
  }

  const repoCount = repos.filter((repo) => !repo.skipped).length;
  out.push(
    `Checked ${repoCount} repo(s): ${
      Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${count} ${status}`)
        .join(", ") || "nothing tracked"
    }${flags.all ? "" : " (current/types-only/not-bundled/external hidden; --all shows them)"}.`,
  );
  const published = repos.filter((repo) => repo.published);
  if (published.length) {
    const noLock = published.filter(
      (repo) => repo.published!.lockfile === "unavailable",
    );
    out.push(
      `--published: inspected ${published.length} tarball(s)${noLock.length ? `; no release lockfile for ${noLock.map((r) => r.repo).join(", ")} (versions unknown)` : ""}.`,
    );
  }
  const heuristic = repos.filter((repo) =>
    repo.modulesSource?.startsWith("none"),
  );
  if (heuristic.length)
    out.push(
      `No source maps for ${heuristic.map((r) => r.repo).join(", ")}: bundled set assumed from build config + lockfile.`,
    );
  for (const repo of repos.filter((r) => r.skipped))
    out.push(`  skipped ${repo.repo}: ${repo.skipped}`);
  for (const repo of repos)
    for (const note of repo.notes) out.push(`  ${repo.repo}: ${note}`);
  for (const error of errors) out.push(`  error: ${error}`);
  if (failOn)
    out.push(
      failing.length
        ? `FAIL (--fail-on ${failOn}): ${failing.length} row(s) in ${new Set(failing.map((r) => r.repo)).size} repo(s).`
        : `OK (--fail-on ${failOn}).`,
    );
  console.log(out.join("\n"));
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    logError("bundled-deps-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
