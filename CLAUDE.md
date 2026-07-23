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
