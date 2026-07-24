# Quartz v5 Dev-Mode Workspace Guidance

## Package Manager Boundary

The workspace uses **pnpm** at the root. Plugin repositories inside `repos/` keep their own **npm** workflows for publishing. Never mix the two.

## Workspace Override Mechanism

`.pnpmfile.cjs` rewrites all `@quartz-community/*` and `@jackyzha0/quartz` dependencies to `workspace:*` so pnpm links local clones. Never modify plugin `package.json` files to force local linking.

`pnpm-workspace.yaml` also declares `overrides` for `@quartz-community/types`, `@quartz-community/utils`, `@quartz-community/runtime`, and `@jackyzha0/quartz` to ensure pnpm and Turborepo both resolve them as workspace packages. `@quartz-community/rehype-obsidian` and `@quartz-community/remark-obsidian` are also overridden (dependencies of `obsidian-flavored-markdown`). Two deprecated `@types` stubs (`@types/flexsearch`, `@types/lz-string`) are overridden to `link:./empty-stub` to prevent them leaking into sibling package type resolution.

## Turbo Graph

`scripts/generate-turbo-graph.ts` builds the turbo dependency graph from plugin package.json dependencies. It is recreated during setup, add, and remove workflows.

## Commands

All workspace commands are available via `just`. Run `just` to list them.

```bash
just setup                  # clone all repos, install, build
just add-plugin <name>      # add a single plugin
just remove-plugin <name>   # remove a plugin
just sync                   # pull latest for all repos
just validate               # check workspace integrity
just typecheck              # cross-repo type checking
just test-plugin <name>     # test a specific plugin
just build-plugin <name>    # build a specific plugin
just check                  # full suite
```

The underlying pnpm scripts still work (`pnpm add-plugin`, `pnpm validate`, etc.).

## File Locations

- `dev.yaml`: Repo manifest and presets.
- `repos/`: Cloned repositories (gitignored).
- `.pnpmfile.cjs`: Rewrite hook for workspace linking.
- `pnpm-workspace.yaml`: Workspace packages, catalog, and pnpm settings.
- `turbo.json`: Pipeline and package task dependencies.
- `scripts/`: Workspace management scripts.
- `.github/workflows/`: CI workflows.

## Key Constraints

- `.npmrc` sets `ignore-scripts=true` to block lifecycle scripts.
- `pnpm-workspace.yaml` `onlyBuiltDependencies` allows native packages (`esbuild`, `@parcel/watcher`, `sharp`).
- `publicHoistPattern` keeps `@types/hast`, `@types/mdast`, `@types/unist`, `@types/node`, `esbuild`, and `sass` available at the root.
- `overrides` pins `prettier` to `^3.8.1` across the workspace to prevent version mismatches with plugin CI.

## Git Workflow (MANDATORY)

**Always use `just` commands for git operations.** Never use raw `git commit` / `git push`.

```bash
just commit <repo> "<message>"   # stage (excluding dist/), commit
just push                        # runs `just check` FIRST (typecheck + lint + format:check + test), then pushes all dirty repos
just dirty                       # show which repos have uncommitted changes
```

`just push` runs `just check` before pushing, then pushes all repos with uncommitted changes OR unpushed commits. `just check` includes **`format:check`** (prettier). If you skip this and push manually, unformatted code will land on the remote.

Individual repos (e.g., `repos/quartz`) also have their own formatting:

```bash
cd repos/quartz && npm run format   # prettier --write
cd repos/quartz && npm run check    # tsc --noEmit + prettier --check
```

**Before any commit**: run `just check` or at minimum `npm run format` in the affected repo. Do not commit unformatted code.

## E2E Test Infrastructure

Browser-based E2E tests live in `e2e/` (not a workspace package). Run via:

```bash
just e2e                         # build fixture + run Playwright tests
just e2e-build <fixture>         # build a specific fixture site
just e2e-test                    # run Playwright tests (fixtures must be pre-built)
just install-browsers            # install Chromium (not needed in nix develop)
```

The Nix flake provides Chromium via `pkgs.chromium` and sets `CHROME_BIN`. In `nix develop`, browser installation is automatic. Outside Nix, run `just install-browsers` or set `CHROME_BIN` to a local Chromium path.

E2E fixture builds require `install-plugins` to generate `.quartz/plugins/index.ts`. The `e2e/helpers/build-fixture.ts` script handles this automatically.

## Plugin Release Workflow

Plugins use **changesets** for versioning and publishing. The workflow:

1. Add a changeset: create a `.changeset/<name>.md` file describing the change and bump type
2. Commit and push to `main`
3. CI creates a "Version Package" PR that bumps `package.json`
4. Merge that PR → CI publishes to npm
5. After npm publish, update the Quartz lockfile: `just update-quartz-lockfile && just push`

Release workflows require `NODE_AUTH_TOKEN` (set from `NPM_TOKEN` secret) for npm auth. The template in `scripts/deploy-changesets.ts` includes this.

## Pitfalls

- **Plugin npm names ≠ directory names**: e.g., `@quartz-community/quartz-fonts` lives in `repos/fonts/`. The `.pnpmfile.cjs` workspace linking resolves by npm package name, not directory name. Never use `generate-dev-config`-style source rewriting (`@quartz-community/X` → `../X`) because it assumes name = directory.
- **`Head.tsx` depends on the plugin index**: Quartz core's `Head.tsx` imports from `.quartz/plugins/index.ts`, which is generated by `install-plugins`. Building without running this step first will fail. The `og-image` dependency was decoupled (PR #2495) but other imports from the plugin index may still exist.
- **All dependents use caret ranges**: Patch bumps to infrastructure packages (`utils`, `types`, `runtime`) are compatible with all dependents — no downstream `package.json` changes needed.
