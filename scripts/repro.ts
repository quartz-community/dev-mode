/**
 * Self-contained bug reproductions: e2e/repros/<slug>/
 *
 *   repro new <slug> [--from default|fixture:<name>] [--issue <ref>] [--plugin <name>]... [--title "..."]
 *   repro list [--json]
 *   repro build <slug> [--verbose]          build only (prints output dir + stale-dist warnings)
 *   repro test [slug] [--headed] [-- <playwright args>]
 *   repro check <slug> [--expect-fail]      build + test; --expect-fail inverts (confirm a repro reproduces)
 *
 * Layout of a repro:
 *   README.md            issue, steps, expected vs actual, status (frontmatter)
 *   quartz.config.yaml   overlay on the default config (or a fixture) — keep it minimal
 *   content/             the smallest vault that triggers the bug
 *   repro.spec.ts        Playwright test asserting the EXPECTED behaviour
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parseArgs } from "./lib/args.js";
import { rel, WORKSPACE_ROOT } from "./lib/sandbox.js";
import {
  formatStaleDists,
  listRepros,
  parseSiteTarget,
  prepareSite,
  REPROS_DIR,
} from "./lib/site-target.js";

const TEST_TIMEOUT_MS = 15 * 60_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const USAGE = `Usage:
  repro new <slug> [--from default|fixture:<name>] [--issue <ref>] [--plugin <name>]... [--title "..."]
  repro list [--json]
  repro build <slug> [--verbose]
  repro test [slug] [--headed] [-- <playwright args>]
  repro check <slug> [--expect-fail]`;

function collectRepeated(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${flag}` && argv[i + 1]) values.push(argv[i + 1]);
    else if (argv[i].startsWith(`--${flag}=`))
      values.push(argv[i].slice(flag.length + 3));
  }
  return values.flatMap((v) => v.split(",")).filter(Boolean);
}

export function renderOverlay(options: {
  from: string;
  slug: string;
  plugins: string[];
}): string {
  const lines = [
    "# Overlay on top of a base config — keep it to what the repro needs.",
    "# See scripts/lib/sandbox.ts (ConfigOverlay) for all keys.",
    `extends: ${options.from}`,
    "configuration:",
    `  pageTitle: "Repro: ${options.slug}"`,
    "  # Serve at the site root. Use e.g. localhost/sub to reproduce base-path bugs.",
    "  baseUrl: localhost",
    "# only: [obsidian-flavored-markdown, content-page]   # enable ONLY these",
    "# enable: [graph]",
    "# disable: [explorer]",
  ];
  if (options.plugins.length) {
    lines.push("plugins:");
    for (const p of options.plugins) {
      lines.push(`  ${p}:`, "    enabled: true", "    options: {}");
    }
  } else {
    lines.push(
      "# plugins:",
      "#   graph:",
      "#     options: { localGraph: { depth: 2 } }",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderReadme(options: {
  slug: string;
  title: string;
  issue?: string;
  plugins: string[];
}): string {
  return `---
title: ${JSON.stringify(options.title)}
issue: ${options.issue ? JSON.stringify(options.issue) : "null"}
plugins: [${options.plugins.join(", ")}]
status: open   # open | reproduced | fixed | wontfix
---

# ${options.title}

## Problem
<!-- What goes wrong, in one or two sentences. Link the issue. -->

## Steps
1. \`just repro-build ${options.slug}\` (or \`just site-serve repro:${options.slug}\`)
2. Open \`/\` …

## Expected
<!-- Asserted by repro.spec.ts -->

## Actual

## Notes
<!-- Root cause, affected plugins (\`just catalog impact <plugin>\`), fix PR links. -->
`;
}

export function renderSpec(options: { slug: string; title: string }): string {
  return `import { test, expect } from "../../helpers/repro-fixture";

// Assert the EXPECTED (correct) behaviour: this test should FAIL while the bug
// exists and PASS once it's fixed. Confirm with: just repro-check ${options.slug} --expect-fail

test.describe(${JSON.stringify(options.title)}, () => {
  test("index page renders without errors", async ({ page, site, pageProblems }) => {
    await page.goto(site.url("/"));
    await expect(page.locator("article")).toBeVisible();
    expect(pageProblems.all()).toEqual([]);
  });

  // test("expected behaviour", async ({ page, site }) => {
  //   await page.goto(site.url("some-page"));
  //   await expect(page.locator(".callout-title-inner")).toHaveText("Title");
  // });
});
`;
}

const INDEX_MD = `---
title: Repro index
---

Minimal content that triggers the bug goes here. Add more pages in this folder
as needed (wikilinks: [[other-page]]).
`;

function cmdNew(
  slug: string | undefined,
  argv: string[],
  flags: Record<string, string | boolean>,
) {
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid slug "${slug ?? ""}" (lowercase letters, digits, hyphens; e.g. 2490-mermaid-spa)`,
    );
  }
  const dir = join(REPROS_DIR, slug);
  if (existsSync(dir)) throw new Error(`Repro already exists: ${rel(dir)}`);
  const from = typeof flags.from === "string" ? flags.from : "default";
  if (from.startsWith("fixture:")) parseSiteTarget(from); // validate
  const plugins = collectRepeated(argv, "plugin");
  const issue = typeof flags.issue === "string" ? flags.issue : undefined;
  const title =
    typeof flags.title === "string"
      ? flags.title
      : issue
        ? `Repro for ${issue}`
        : `Repro: ${slug}`;

  mkdirSync(join(dir, "content"), { recursive: true });
  writeFileSync(
    join(dir, "README.md"),
    renderReadme({ slug, title, issue, plugins }),
  );
  writeFileSync(
    join(dir, "quartz.config.yaml"),
    renderOverlay({ from, slug, plugins }),
  );
  writeFileSync(join(dir, "content/index.md"), INDEX_MD);
  writeFileSync(join(dir, "repro.spec.ts"), renderSpec({ slug, title }));
  console.log(`Created ${rel(dir)}/`);
  console.log(
    "  README.md  quartz.config.yaml  content/index.md  repro.spec.ts",
  );
  console.log("Next:");
  console.log(
    `  1. Put the minimal triggering content in ${rel(dir)}/content/`,
  );
  console.log(`  2. Assert the expected behaviour in repro.spec.ts`);
  console.log(
    `  3. just repro-check ${slug} --expect-fail   # confirms it reproduces`,
  );
  console.log(
    `  4. Fix, just build-plugin <name>, then: just repro-check ${slug}`,
  );
}

interface ReproInfo {
  slug: string;
  title?: string;
  issue?: string | null;
  status?: string;
  plugins?: string[];
  hasSpec: boolean;
  contentFiles: number;
}

function readInfo(slug: string): ReproInfo {
  const dir = join(REPROS_DIR, slug);
  let front: Partial<ReproInfo> = {};
  const readme = join(dir, "README.md");
  if (existsSync(readme)) {
    const m = readFileSync(readme, "utf-8").match(/^---\n([\s\S]*?)\n---/);
    if (m) {
      try {
        front = (parse(m[1]) ?? {}) as Partial<ReproInfo>;
      } catch {
        // ignore malformed frontmatter
      }
    }
  }
  const countFiles = (d: string): number =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).reduce(
          (n, e) => n + (e.isDirectory() ? countFiles(join(d, e.name)) : 1),
          0,
        )
      : 0;
  return {
    slug,
    title: front.title,
    issue: front.issue,
    status: front.status,
    plugins: front.plugins,
    hasSpec: readdirSync(dir).some((f) => f.endsWith(".spec.ts")),
    contentFiles: countFiles(join(dir, "content")),
  };
}

function cmdList(flags: Record<string, string | boolean>) {
  const infos = listRepros().map(readInfo);
  if (flags.json) {
    console.log(JSON.stringify(infos, null, 2));
    return;
  }
  if (!infos.length) {
    console.log(
      "No repros yet. Create one with: just repro-new <slug> --issue <ref>",
    );
    return;
  }
  for (const r of infos) {
    console.log(
      `${r.slug.padEnd(36)} ${(r.status ?? "?").padEnd(11)} ${String(r.contentFiles).padStart(3)} files  ${r.issue ?? ""}  ${r.title ?? ""}`,
    );
  }
}

async function cmdBuild(
  slug: string | undefined,
  flags: Record<string, string | boolean>,
) {
  if (!slug) throw new Error("Missing <slug>");
  const prepared = await prepareSite(`repro:${slug}`, {
    name: `repro-${slug}`,
    verbose: Boolean(flags.verbose),
  });
  const build = prepared.build!;
  console.log(
    `✓ Built repro:${slug} in ${(build.durationMs / 1000).toFixed(1)}s → ${rel(build.outDir)} (base path ${prepared.basePath || "/"})`,
  );
  for (const line of formatStaleDists(build)) console.log(line);
  for (const w of build.warnings) console.log(`  ${w}`);
  for (const e of build.errors) console.log(`  ${e}`);
  console.log(
    `Serve it: just site-serve repro:${slug} --no-build   Inspect: just inspect repro:${slug} --no-build`,
  );
}

function runPlaywright(
  args: string[],
  env: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        join(WORKSPACE_ROOT, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        "e2e/playwright.repros.config.ts",
        ...args,
      ],
      {
        cwd: WORKSPACE_ROOT,
        stdio: "inherit",
        env: { ...process.env, ...env },
      },
    );
    const timer = setTimeout(() => child.kill("SIGTERM"), TEST_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise(code ?? 1);
    });
  });
}

function testArgs(
  slug: string | undefined,
  flags: Record<string, string | boolean>,
  passthrough: string[],
): string[] {
  const args: string[] = [];
  if (slug) {
    if (!existsSync(join(REPROS_DIR, slug)))
      throw new Error(`Unknown repro "${slug}"`);
    args.push(`repros/${slug}/`);
  }
  if (flags.headed) args.push("--headed");
  return [...args, ...passthrough];
}

async function main() {
  const argv = process.argv.slice(2);
  const dashdash = argv.indexOf("--");
  const own = dashdash === -1 ? argv : argv.slice(0, dashdash);
  const passthrough = dashdash === -1 ? [] : argv.slice(dashdash + 1);
  const { flags, positional } = parseArgs(own);
  const [command, slug] = positional;
  switch (command) {
    case "new":
      return cmdNew(slug, own, flags);
    case "list":
      return cmdList(flags);
    case "build":
      return cmdBuild(slug, flags);
    case "test": {
      const code = await runPlaywright(testArgs(slug, flags, passthrough));
      process.exit(code);
      break;
    }
    case "check": {
      if (!slug) throw new Error("Missing <slug>");
      // Strict: ignore the README-status "expected to fail" marking.
      const code = await runPlaywright(testArgs(slug, flags, passthrough), {
        REPRO_STRICT: "1",
      });
      if (flags["expect-fail"]) {
        if (code === 0) {
          console.error(
            `✗ repro:${slug} PASSED — it does not reproduce the bug (yet). Tighten the content/spec.`,
          );
          process.exit(1);
        }
        console.log(`✓ repro:${slug} fails as expected — the bug reproduces.`);
        process.exit(0);
      }
      console.log(
        code === 0
          ? `✓ repro:${slug} passes — expected behaviour confirmed.`
          : `✗ repro:${slug} fails.`,
      );
      process.exit(code);
      break;
    }
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
