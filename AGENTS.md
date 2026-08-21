# Quartz v5 Dev-Mode Workspace Guidance

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

| Category | Location in `dev.yaml` | Cloned | Purpose |
|---|---|---|---|
| **Core** | `core:` | Always | Quartz site generator (`@jackyzha0/quartz`) |
| **Infrastructure** | `infrastructure:` | Always | Shared types, utilities, runtime, markdown processors |
| **Themes** | `themes:` | Always | Visual themes (`@quartz-themes/core`) |
| **Plugins** | `plugins:` | By preset | Feature packages (search, graph, explorer, etc.) |
| **Tools** | `tools:` | Always | Ecosystem tools that consume the above (Quartz Syncer) |

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
└── index.ts         # Barrel export
```

When modifying or creating scripts, always import from `./lib/` — never redeclare utilities. Use `.js` extensions in imports for ESM compatibility (e.g., `import { logInfo } from "./lib/log.js"`).

## Commands

All workspace commands are available via `just`. Run `just` to list them.

### Setup & Environment

```bash
just check-env              # verify Node 22+, pnpm 10+, git
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
just e2e                    # build fixtures + run Playwright tests
just e2e-build <fixture>    # build a specific fixture
just e2e-test               # run tests (fixtures must be pre-built)
just install-browsers       # install Chromium (not needed in nix develop)
```

## File Locations

| Path | Purpose |
|---|---|
| `dev.yaml` | Repo manifest: core, infrastructure, themes, plugins, tools, presets, workspace config |
| `repos/` | Cloned repositories (gitignored) |
| `.pnpmfile.cjs` | pnpm readPackage hook for workspace linking |
| `pnpm-workspace.yaml` | Workspace packages, catalog, overrides, hoisting rules |
| `turbo.json` | Auto-generated pipeline and task dependencies |
| `scripts/` | Workspace management scripts |
| `scripts/lib/` | Shared utilities for all scripts |
| `tests/` | Unit tests for workspace scripts (vitest) |
| `e2e/` | Browser E2E tests (Playwright) |
| `e2e/fixtures/` | Pre-built Quartz site fixtures for E2E |
| `.github/workflows/` | CI workflows |

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

| Aspect | Quartz Plugins | Quartz Syncer |
|---|---|---|
| Runtime | Node.js (Quartz build) | Obsidian (Electron) |
| Build | tsup | esbuild → `main.js` |
| Release | npm via changesets | GitHub releases |
| Package name | `@quartz-community/*` | `quartz-syncer` (unscoped) |
| Depends on | types, utils | remark-obsidian |

Syncer has its own `AGENTS.md` at `repos/syncer/AGENTS.md` with architecture details, conventions, and verification steps. Read it before making changes to syncer code.

When working on syncer within the workspace, its dependency on `@quartz-community/remark-obsidian` is workspace-linked — changes to remark-obsidian are immediately visible in syncer builds and tests.

## E2E Test Infrastructure

Browser-based E2E tests live in `e2e/` (not a workspace package). Four fixtures serve pre-built Quartz sites on ports 4173-4176:

- `base-url-site` — SPA navigation with `/test-base` prefix
- `nested-base-url` — Nested base URL (`/Obsidian-TTRPG-Quartz`)
- `bug-repro` — Full-featured site for bug reproduction tests
- `footer-disabled` — Disabled footer component rendering

The Nix flake provides Chromium via `pkgs.chromium` and sets `CHROME_BIN`. Outside Nix, run `just install-browsers`.

Playwright retries are CI-only (`retries: 2` when `CI=true`, `0` locally).

## Plugin Release Workflow

Plugins use **changesets** for versioning and publishing:

1. Add a changeset: create a `.changeset/<name>.md` file describing the change and bump type
2. Commit and push to `main`
3. CI creates a "Version Package" PR that bumps `package.json`
4. Merge that PR → CI publishes to npm
5. After npm publish, update the Quartz lockfile: `just update-quartz-lockfile && just push`

## Pitfalls

- **Plugin npm names ≠ directory names**: e.g., `@quartz-community/quartz-fonts` lives in `repos/fonts/`. The `.pnpmfile.cjs` workspace linking resolves by npm package name, not directory name. The `generate-dev-config` recipe in the justfile resolves this correctly by scanning `repos/*/package.json` — it does not assume name = directory.
- **`Head.tsx` depends on the plugin index**: Quartz core's `Head.tsx` imports from `.quartz/plugins/index.ts`, which is generated by `install-plugins`. Building without running this step first will fail.
- **All dependents use caret ranges**: Patch bumps to infrastructure packages (`utils`, `types`, `runtime`) are compatible with all dependents — no downstream `package.json` changes needed.
- **`@quartz-themes/core` tests fail in workspace**: The theme registry tests run `npm install` inside pnpm-managed `node_modules` which causes `ENOTDIR` errors. These tests are excluded from the workspace CI — they run in the theme repo's own CI.
- **Syncer tests may skip**: Some syncer tests require the Obsidian runtime environment and will show as skipped in the workspace. This is expected.
