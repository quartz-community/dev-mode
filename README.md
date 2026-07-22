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
