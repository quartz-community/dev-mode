# Quartz v5 Dev-Mode Workspace Guidance

## Start Here (agents)

1. `just overview` — toolchain, browser, dirty repos, stale `dist/`, available site targets (1 s, offline).
2. `docs/ARCHITECTURE.md` — how Quartz's pipeline, `file.data`, layout slots and SPA events work, and which tool answers which question.
3. Workflow skills in `.claude/skills/`: `plugin-change`, `reproduce-bug`, `write-e2e-test`, `css-change`, `plugin-dataflow`, `release-plugins`.

### Agent Toolkit

| Need                                                      | Command                                                           | Output                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| What a plugin does / provides / consumes                  | `just catalog show <plugin>`                                      | card (also `.dev/catalog/CATALOG.md`)                                     |
| Who writes / reads `file.data.<key>`                      | `just catalog who-writes <key>` / `who-reads <key>`               | `.dev/catalog/DATA-FLOW.md`                                               |
| Runtime truth of the above for a real build               | `just trace fixture:bug-repro`                                    | `.dev/trace/<name>/TRACE.md` (prototype)                                  |
| Blast radius of a change                                  | `just catalog impact <package>`                                   | dependents, fixtures, specs, commands to run                              |
| Which plugin renders/styles a DOM class                   | `just catalog dom <class>`                                        |                                                                           |
| Build a site without touching `repos/quartz`              | `just site-build <target>`                                        | `.dev/sites/<id>`, stale-dist warnings                                    |
| Look at a rendered page                                   | `just inspect <target> <page> --screenshot`                       | errors, layout map, computed styles, PNG                                  |
| Health-check a whole site                                 | `just site-smoke <target>`                                        | broken links/assets, console/page/SPA errors, mobile overflow             |
| Did a CSS change break anything?                          | `just visual-baseline` → edit → `just visual-check`               | pixel + computed-style diff report                                        |
| Turn an issue into a failing test                         | `just repro-new <slug>` → `just repro-check <slug> --expect-fail` | `e2e/repros/<slug>/`                                                      |
| What needs releasing, in what order                       | `just release-status` / `just release-plan <pkgs>`                | ordered steps, `[ASK]` = outward-facing                                   |
| Is CI green on every repo's default branch?               | `just ci-status [repo…]` (`--prs` for open PRs' checks, `--all`)  | failing workflows + run URLs; exit 1 if any branch fails (read-only `gh`) |
| How does real Obsidian (Bases) render/evaluate this? | `just obsidian-bases-probe <vault-dir>` (`--keep` + `eval --formulas '{…}'` for ad hoc formulas) | `.dev/obsidian-bases-probe/<name>/SUMMARY.md`, DOM, evaluated values, screenshots |
| Does a repo's own CI test the same deps as the workspace? | `just drift [pkg…]` (also in `just release-status`)               | package-lock.json vs pnpm-lock.yaml major/minor differences               |
| Add CI to changesets version PRs across repos             | `just version-pr-ci [repo…] [--dry-run]`                          | local branch per repo; `--push` = outward-facing                          |

`<target>` = `fixture:<name>` · `repro:<slug>` · `docs` · a directory with `content/` (+ optional `quartz.config.yaml`). List: `just site-targets`.
Most commands accept `--json`. All generated output goes to `.dev/` (gitignored).

## Ecosystem Model

This workspace unifies the Quartz v5 ecosystem into a single pnpm monorepo for cross-repo development and testing. Understanding the dependency hierarchy is critical before making changes.

```
┌─────────────────────────────────────────────────────────┐
│                    Quartz Core                          │
│                 (@jackyzha0/quartz)                     │
│         Static site generator, consumes all below       │
└──────────┬──────────┬───────────┬───────────┬───────────┘
           │          │           │           │
    ┌──────▼──┐  ┌────▼────┐  ┌──▼───┐  ┌────▼─────┐
    │ Plugins │  │ Themes  │  │ Tools│  │ E2E Tests│
    │  (50+)  │  │  (core) │  │(sync)│  │(fixtures)│
    └──────┬──┘  └────┬────┘  └──┬───┘  └──────────┘
           │          │          │
    ┌──────▼──────────▼──────────▼──────┐
    │        Infrastructure             │
    │  types ← utils ← runtime         │
    │  rehype-obsidian, remark-obsidian │
    └───────────────────────────────────┘
```

### Package Categories

| Category           | Location in `dev.yaml` | Cloned    | Purpose                                                |
| ------------------ | ---------------------- | --------- | ------------------------------------------------------ |
| **Core**           | `core:`                | Always    | Quartz site generator (`@jackyzha0/quartz`)            |
| **Infrastructure** | `infrastructure:`      | Always    | Shared types, utilities, runtime, markdown processors  |
| **Themes**         | `themes:`              | Always    | Visual themes (`@quartz-themes/core`)                  |
| **Plugins**        | `plugins:`             | By preset | Feature packages (search, graph, explorer, etc.)       |
| **Tools**          | `tools:`               | Always    | Ecosystem tools that consume the above (Quartz Syncer) |

### Dependency Flow (Impact Assessment)

Changes ripple downstream. Before modifying a package, understand what depends on it:

- **`@quartz-community/types`** → Everything. All plugins, infrastructure, themes, and tools depend on types. Changes here require workspace-wide typecheck (`just typecheck`).
- **`@quartz-community/utils`** → Most plugins + runtime + tools. Breaking changes affect 40+ packages.
- **`@quartz-community/remark-obsidian`** → `obsidian-flavored-markdown` plugin + Quartz Syncer. Changes here affect both the build pipeline and the Obsidian publishing tool.
- **A single plugin** → Usually only Quartz core. Low blast radius. Safe to change in isolation.
- **Quartz Syncer** → Nothing depends on it. It's a leaf consumer. Safe to change without affecting the rest of the workspace.

When in doubt, run `just check` after changes to verify nothing is broken.

## Package Manager Boundary

The workspace uses **pnpm** at the root. Plugin repositories inside `repos/` keep their own **npm** workflows for publishing. Never mix the two.

Quartz Syncer (`repos/syncer/`) also uses npm for its standalone workflow (esbuild bundling for Obsidian). In the workspace, pnpm manages its dependencies via workspace linking. The syncer has its own `AGENTS.md` with package-specific conventions.

### Standalone repos

A plugin marked `standalone: true` in `dev.yaml` (currently `tui`, which runs under bun and whose UI library needs Node 24+) is cloned into `repos/` but is **not** a pnpm workspace member: it is excluded in `pnpm-workspace.yaml` (`"!repos/<name>"`, checked by `just validate`), and `just setup` installs and builds it with its own lockfile (`npm ci && npm run build`). Rebuild it the same way after changes — `just build-plugin` and turbo don't see it.

## Workspace Linking

`.pnpmfile.cjs` rewrites all `@quartz-community/*`, `@quartz-themes/*`, and `@jackyzha0/quartz` dependencies to `workspace:*` so pnpm resolves them from local clones in `repos/`. Never modify plugin `package.json` files to force local linking.

`pnpm-workspace.yaml` declares matching `overrides` to ensure both pnpm and Turborepo resolve workspace packages consistently.

## Turbo Graph

`scripts/generate-turbo-graph.ts` auto-detects workspace dependencies by scanning `repos/*/package.json` and generates the turbo task dependency graph in `turbo.json`. The file is auto-generated — do not edit package-specific entries manually. Run `just generate-graph` to regenerate.

The graph is recreated automatically during setup, add-plugin, and remove-plugin workflows.

## Script Infrastructure

All workspace scripts live in `scripts/` and share utilities from `scripts/lib/`:

```
scripts/lib/
├── args.ts          # CLI argument parsing (--key value, --key=value, --)
├── concurrency.ts   # Worker pool with error collection
├── exec.ts          # runCommand (void) + runCommandCapture (string) with timeouts
├── git.ts           # getDefaultBranch via git ls-remote
├── json.ts          # safeReadJson with descriptive error messages
├── log.ts           # Structured JSON logging (logInfo, logWarn, logError)
├── manifest.ts      # readManifest() for dev.yaml
├── semver.ts        # Semver parsing and range matching
├── types.ts         # Shared TypeScript interfaces (Manifest, ManifestRepo, etc.)
├── validation.ts    # Plugin name validation
├── sandbox.ts       # Isolated Quartz builds in .dev/sandboxes, config overlays, stale-dist detection
├── site-target.ts   # Resolve fixture:/repro:/docs/dir targets and build them
├── static-server.ts # Static server (free ports, base paths, clean URLs, 404.html)
├── browser.ts       # Find a Chromium that actually launches (NixOS-safe)
├── page-routing.ts  # Serve absolute https://<baseUrl>/… requests from the local build
├── catalog/         # Static plugin analysis (catalog.ts)
├── release/         # Release status / planning / changesets (release.ts)
├── trace/           # Runtime data-flow tracer patches + recorder (trace.ts)
└── index.ts         # Barrel export
```

When modifying or creating scripts, always import from `./lib/` — never redeclare utilities. Use `.js` extensions in imports for ESM compatibility (e.g., `import { logInfo } from "./lib/log.js"`).

## Commands

All workspace commands are available via `just`. Run `just` to list them.

### Setup & Environment

```bash
just check-env              # verify Node (pinned in .node-version), pnpm 10+, git
just setup                  # clone all repos, install, build (runs check-env first)
just setup minimal          # clone with minimal preset
just add-plugin <name>      # add a single plugin
just remove-plugin <name>   # remove a plugin
```

### Development

```bash
just watch                  # rebuild on file changes (turbo watch)
just dev                    # watch + Quartz live server with hot-reload
just serve                  # build and serve Quartz docs site
just build-affected         # build only changed packages
just build-plugin <name>    # build a specific plugin
```

### Verification

```bash
just check                  # full suite: typecheck + lint + format:check + test
just typecheck              # cross-repo type checking
just test                   # run all plugin tests
just test-plugin <name>     # test a specific plugin
just test-unit              # run workspace script unit tests (vitest)
just lint                   # lint all packages
just validate               # check workspace integrity (singletons, overrides, engines)
```

### Git

```bash
just commit <repo> "<msg>"  # stage (excluding dist/), commit
just push                   # runs just check FIRST, then pushes all dirty repos
just dirty                  # show repos with uncommitted changes
just sync                   # pull latest for all repos
just status                 # show branches, dirty state, behind count
```

### E2E Tests

```bash
just e2e                    # build all fixtures (parallel, sandboxed) + suites + repros
just e2e-build [fixture…]   # build fixtures (default: all)
just e2e-test [args]        # run fixture suites (fixtures must be pre-built)
just repro-test [slug]      # run self-contained repros (build on demand)
just which-browser          # which Chromium Playwright will use, and why
just install-browsers       # install Chromium (not needed in nix develop)
```

### Sites, Repros, Inspection

```bash
just site-targets                     # fixtures + repros you can build
just site-build <target>              # sandboxed build → .dev/sites/<id>
just site-serve <target>              # production-like static server
just site-dev <target>                # Quartz live-reload server, sandboxed
just site-config <target>             # resolved config after overlays
just site-smoke <target>              # whole-site health check
just repro-new <slug> [--issue ref] [--plugin name] [--from fixture:x]
just repro-check <slug> [--expect-fail]
```

## File Locations

| Path                   | Purpose                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `dev.yaml`             | Repo manifest: core, infrastructure, themes, plugins, tools, presets, workspace config                               |
| `repos/`               | Cloned repositories (gitignored)                                                                                     |
| `.pnpmfile.cjs`        | pnpm readPackage hook for workspace linking                                                                          |
| `pnpm-workspace.yaml`  | Workspace packages, catalog, overrides, hoisting rules                                                               |
| `turbo.json`           | Auto-generated pipeline and task dependencies                                                                        |
| `scripts/`             | Workspace management scripts                                                                                         |
| `scripts/lib/`         | Shared utilities for all scripts                                                                                     |
| `tests/`               | Unit tests for workspace scripts (vitest)                                                                            |
| `e2e/`                 | Browser E2E tests (Playwright)                                                                                       |
| `e2e/fixtures/`        | Quartz site fixtures for the E2E suites                                                                              |
| `e2e/repros/`          | Self-contained repros: content + config overlay + spec (see `reproduce-bug` skill)                                   |
| `docs/ARCHITECTURE.md` | Quartz pipeline + dev-mode tooling map                                                                               |
| `.claude/skills/`      | Agent workflow skills                                                                                                |
| `.dev/`                | Generated, gitignored: `sandboxes/`, `sites/`, `catalog/`, `visual/`, `inspect/`, `trace/`, `logs/`, `test-results/` |
| `.github/workflows/`   | CI workflows                                                                                                         |

## Key Constraints

- `.npmrc` sets `ignore-scripts=true` to block lifecycle scripts.
- `pnpm-workspace.yaml` `onlyBuiltDependencies` allows native packages (`esbuild`, `@parcel/watcher`, `sharp`).
- `publicHoistPattern` keeps `@types/hast`, `@types/mdast`, `@types/unist`, `@types/node`, `esbuild`, and `sass` available at the root.
- `overrides` pins `prettier` to `^3.8.1` across the workspace to prevent version mismatches with plugin CI.
- Plugin names are validated against `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` (lowercase, hyphens, 1-64 chars).
- All `execSync`/`spawn` calls have timeouts. Do not add unguarded subprocess calls.
- All `JSON.parse` calls on files use `safeReadJson()` from `scripts/lib/json.ts`. Do not use bare `JSON.parse(readFileSync(...))`.

## Git Workflow (MANDATORY)

**Always use `just` commands for git operations.** Never use raw `git commit` / `git push`.

`just push` runs `just check` before pushing, which includes **`format:check`** (prettier). If you skip this and push manually, unformatted code will land on the remote.

**Before any commit**: run `just check` or at minimum `npm run format` in the affected repo. Do not commit unformatted code.

## Cross-Repo Changes

When a change spans multiple packages:

1. **Start from the bottom** of the dependency graph. Change `types` before `utils`, `utils` before plugins.
2. **Build incrementally**: `just build-affected` rebuilds only what changed and its dependents.
3. **Run `just typecheck`** after interface changes — it typechecks all packages.
4. **Run `just validate`** after dependency changes — it checks singleton versions and workspace linking.
5. **Commit per-repo** with `just commit <repo> "<message>"` — each repo is an independent git repository.

## Tools (Quartz Syncer)

`repos/syncer/` contains Quartz Syncer, an Obsidian plugin that publishes vault notes to Quartz sites. It is NOT a Quartz plugin — it's an Obsidian plugin that consumes the Quartz ecosystem.

Key differences from plugins:

| Aspect       | Quartz Plugins         | Quartz Syncer              |
| ------------ | ---------------------- | -------------------------- |
| Runtime      | Node.js (Quartz build) | Obsidian (Electron)        |
| Build        | tsup                   | esbuild → `main.js`        |
| Release      | npm via changesets     | GitHub releases            |
| Package name | `@quartz-community/*`  | `quartz-syncer` (unscoped) |
| Depends on   | types, utils           | remark-obsidian            |

Syncer has its own `AGENTS.md` at `repos/syncer/AGENTS.md` with architecture details, conventions, and verification steps. Read it before making changes to syncer code.

When working on syncer within the workspace, its dependency on `@quartz-community/remark-obsidian` is workspace-linked — changes to remark-obsidian are immediately visible in syncer builds and tests.

## E2E Test Infrastructure

Browser-based E2E tests live in `e2e/` (not a workspace package). Four fixtures serve pre-built Quartz sites on ports 4173-4176:

- `base-url-site` — SPA navigation with `/test-base` prefix
- `nested-base-url` — Nested base URL (`/Obsidian-TTRPG-Quartz`)
- `bug-repro` — Full-featured site for bug reproduction tests
- `footer-disabled` — Disabled footer component rendering

Fixtures are built in isolated sandboxes (`scripts/lib/sandbox.ts`) — builds never write to `repos/quartz`, and `just e2e-build` builds all fixtures in parallel (~3 s).

Self-contained **repros** live in `e2e/repros/<slug>/` and run via `e2e/playwright.repros.config.ts`; each spec builds and serves its own site on a free port (`e2e/helpers/repro-fixture.ts`, fixtures `site` and `pageProblems`). README frontmatter `status: open|reproduced` marks a repro as expected-to-fail so suites stay green; Playwright reports "expected to fail, but passed" once it's fixed → set `status: fixed`. `just repro-check` runs strict (raw result).

Browser: `scripts/lib/browser.ts` probes `CHROME_BIN`, the user/system Nix profiles and `PATH` for a Chromium that launches (a stale direnv `CHROME_BIN` can point at a Chromium with a mismatched glibc). Override with `PLAYWRIGHT_CHROMIUM=<path>` or `=bundled`. Outside Nix, run `just install-browsers`.

Playwright retries are CI-only (`retries: 2` when `CI=true`, `0` locally).

## Plugin Release Workflow

Plugins use **changesets** for versioning and publishing:

1. Add a changeset: create a `.changeset/<name>.md` file describing the change and bump type
2. Commit and push to `main`
3. CI creates a "Version Package" PR that bumps `package.json`
4. Merge that PR → CI publishes to npm
5. After npm publish, update the Quartz lockfile: `just update-quartz-lockfile && just push`

### Quartz core versioning

Quartz core (`@jackyzha0/quartz`, `repos/quartz`) is not published to npm, but is versioned with changesets too (tags `vX.Y.Z`, starting from `v5.0.0`):

- Every user-facing core change gets a changeset (`"@jackyzha0/quartz": patch|minor|major`). On `v5`, `.github/workflows/release.yaml` keeps a "chore: release Quartz" PR open; merging it tags `vX.Y.Z` and creates the GitHub release.
- **Do not run `npx changeset` inside this workspace** — in `repos/quartz` it finds the dev-mode pnpm root, not Quartz. Use `just release-changeset --bump <patch|minor|major> --summary "<text>" quartz` (`--dry-run` to preview), or write `repos/quartz/.changeset/<slug>.md` by hand. `npx changeset status` is likewise wrong here; `just release-status` covers core.
- `repos/quartz` must have full history and tags (`git describe --match v*` feeds `quartz info` and the build banner). `just setup` clones core unshallowed; for an older shallow clone run `git -C repos/quartz fetch --unshallow --tags`.
- A plugin that needs a newer core declares it in `package.json` → `quartz.quartzVersion` (e.g. `">=5.1.0"`) **after that core version is released**. Quartz warns on local builds and fails builds in CI on a mismatch; dev-mode sandboxes set `QUARTZ_ALLOW_INCOMPATIBLE_PLUGINS=1` outside CI so unreleased requirements only warn.

## Pitfalls

- **Turbo caching and `--affected` cannot see plugin sources**: turbo hashes inputs through the _root_ git repo, where `repos/` is ignored, so every package hashes to "no inputs". With caching on, edited plugins got their old `dist/` replayed and tests replayed cached passes; `--affected` never selected anything (also in CI). `turbo.json` therefore sets `cache: false` (enforced by `scripts/generate-turbo-graph.ts`; a full build is ~25 s), and `just build-affected` / `typecheck-affected` / `test-affected` use `scripts/changed.ts` (per-repo git status + unpushed commits → `--filter=...<pkg>`). `just changed` lists what it detects.

- **Quartz runs plugin `dist/`, not `src/`**: after editing a plugin run `just build-plugin <name>` (or keep `just watch` running). Sandboxed builds print `⚠ <name>: dist/ is older than src/` when you forget; `just overview` lists every stale package.
- **Content under `.dev/` is invisible to Quartz**: Quartz globs with `gitignore: true` and `.dev/` is gitignored. Keep content in `e2e/` (sandboxes are their own git roots for this reason).
- **Absolute production URLs in local runs**: Quartz emits some `https://<baseUrl>/…` URLs (fonts, og images). Browser tooling routes these to the local build (`scripts/lib/page-routing.ts`); raw Playwright tests don't.

- **Plugin npm names ≠ directory names**: e.g., `@quartz-community/quartz-fonts` lives in `repos/fonts/`. The `.pnpmfile.cjs` workspace linking resolves by npm package name, not directory name. The `generate-dev-config` recipe in the justfile resolves this correctly by scanning `repos/*/package.json` — it does not assume name = directory.
- **`Head.tsx` depends on the plugin index**: Quartz core's `Head.tsx` imports from `.quartz/plugins/index.ts`, which is generated by `install-plugins`. Building without running this step first will fail.
- **All dependents use caret ranges**: Patch bumps to infrastructure packages (`utils`, `types`, `runtime`) are compatible with all dependents — no downstream `package.json` changes needed.
- **Green in the workspace ≠ green in the repo's CI**: the workspace installs through pnpm (`pnpm-lock.yaml`), each repo's CI through its own `package-lock.json`. A stale lockfile can pin an older dependency that breaks only in CI (themes-core: `@lucide/icons` 1.70 here, 1.26 in its lockfile). `just drift` lists such differences; `just ci-status` shows what actually ran.
- **Version PRs get no CI**: changesets/action pushes `changeset-release/main` with `GITHUB_TOKEN`, which triggers no workflows, so a version PR shows no checks. `just version-pr-ci [repo…]` patches each repo's own `ci.yml`/`release.yml` to run `ci.yml` on the version PR and report a `CI / version PR` commit status (local `dev-mode/version-pr-ci` branches via git plumbing, working trees untouched; `--dry-run`; `--push` pushes and opens PRs). Prototype: `repos/note-properties` branch `dev-mode/version-pr-ci`.
- **Sandboxes must use the workspace's `node_modules`**: each sandbox's `node_modules` is a link to `repos/quartz/node_modules`. A plugin that runs `npm install` at build time (quartz-themes-core installs a missing theme that way) replaces it with a real directory of registry packages, and every later build of that sandbox silently used them (an old `@quartz-community/utils` without a new export). `prepareSandbox` now restores the link and logs `sandbox-node-modules-replaced`. The themes the repros use (`@quartz-themes/tokyo-night`, `catppuccin`) are root devDependencies, so the workspace's quartz-themes-core finds them; `.pnpmfile.cjs` links only `@quartz-themes/core`, not the theme data packages. A repro with another theme needs that theme added there too.
- **`@quartz-themes/core` tests fail in workspace**: The theme registry tests run `npm install` inside pnpm-managed `node_modules` which causes `ENOTDIR` errors. These tests are excluded from the workspace CI — they run in the theme repo's own CI.
- **Syncer tests may skip**: Some syncer tests require the Obsidian runtime environment and will show as skipped in the workspace. This is expected.
