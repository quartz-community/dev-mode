# Quartz v5 Dev-Mode Workspace

## Overview

This repository provides a unified development workspace for Quartz v5 core, infrastructure packages, and first-party plugins. It is designed to clone the ecosystem into a single pnpm workspace so changes can be validated across repos without running a Quartz site.

## Prerequisites

- Node.js 22+
- pnpm 10+
- git
- Optional: Nix (for a fully reproducible environment)

## Quick Start

```bash
git clone https://github.com/quartz-community/dev-mode.git
cd dev-mode
just setup            # clones all repos, installs, builds
```

With Nix:

```bash
nix develop           # drops into shell with Node 22, pnpm, just, libvips
just setup
```

To build only what changed:

```bash
just build-affected
```

## Available Presets

- `minimal`: Core + infrastructure + essential transformers
- `content-pipeline`: All transformers and filters
- `ui`: All component plugins
- `full` (default): Everything

```bash
just setup minimal
just setup content-pipeline
```

## Common Workflows

```bash
just add-plugin graph       # add a single plugin
just remove-plugin graph    # remove a plugin
just sync                   # pull latest for all repos
just validate               # check workspace integrity
just typecheck              # cross-repo type checking
just test-plugin search     # test a specific plugin
just build-plugin graph     # build a specific plugin
just check                  # full suite: typecheck + lint + format + test
```

Run `just` with no arguments to see all available commands.

## Git Workflow

**Always use `just` commands for git operations.** Raw `git commit` / `git push` will skip formatting checks.

```bash
just commit <repo> "<message>"   # stage (excluding dist/), commit
just push                        # runs full checks first, then pushes all dirty repos
just dirty                       # show which repos have uncommitted changes
```

`just push` runs `just check` (typecheck + lint + format + test) before pushing. This prevents unformatted code from reaching the remote.

Individual repos also have their own formatting:

```bash
cd repos/quartz && npm run format   # prettier --write
cd repos/quartz && npm run check    # tsc --noEmit + prettier --check
```

## Plugin Development

### Working on an existing plugin

1. Clone the workspace: `just setup` (or `just add-plugin <name>` for a single plugin)
2. Edit plugin source in `repos/<name>/src/`
3. Build: `just build-plugin <name>`
4. Test: `just test-plugin <name>`
5. Type-check: `just typecheck`

### Testing with a live Quartz site

```bash
just dev    # starts watcher + Quartz dev server with live-reload
```

Edit plugin code, changes rebuild automatically, browser refreshes.

### Creating a new plugin

Use the plugin template:

```bash
gh repo create quartz-community/<name> --template quartz-community/quartz-plugin-template
just add-plugin <name>
```

### Publishing

Plugins use changesets for versioning:

1. Add a changeset: create a `.changeset/<name>.md` file
2. Commit and push to `main`
3. CI creates a "Version Package" PR
4. Merge the PR — CI publishes to npm
5. Update Quartz lockfile: `just update-quartz-lockfile && just push`

## How It Works

- **pnpm workspace**: `repos/*` is a single workspace. Shared dependencies are managed at the root.
- **Override hook**: `.pnpmfile.cjs` rewrites `github:quartz-community/*` to `workspace:*` for local linking.
- **Turbo pipeline**: `turbo.json` defines build order and affected runs. The dependency graph is created by `scripts/generate-turbo-graph.ts` based on plugin dependencies.

## Troubleshooting

- **No lockfile**: `pnpm-lock.yaml` is intentionally not committed. Each setup recreates it.
- **Install skips scripts**: `.npmrc` sets `ignore-scripts=true`. If a package needs a postinstall, add it to `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
- **Missing repos**: Run `just setup` or `just add-plugin <name>` to clone required packages.
- **Manifest sync**: `just sync-manifest` requires `gh` CLI and `GITHUB_TOKEN`.
- **just not found**: Install via your system package manager or use the Nix flake (`nix develop`).

## For Agent Tools

See `CLAUDE.md` for workspace rules, constraints, and task flows.

## License

MIT
