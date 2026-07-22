set dotenv-load := false

# List available commands
default:
    @just --list

# --- Setup & Teardown ---

# Clone repos and set up workspace (preset: minimal, content-pipeline, ui, full)
setup preset="full":
    pnpm run dev-setup -- --preset {{preset}}

# Clone repos (dry run — show what would happen)
setup-dry preset="full":
    pnpm run dev-setup -- --preset {{preset}} --dry-run

# Add a single plugin to the workspace
add-plugin name:
    pnpm add-plugin {{name}}

# Remove a plugin from the workspace
remove-plugin name:
    pnpm remove-plugin {{name}}

# --- Day-to-day ---

# Pull latest changes for all cloned repos
sync:
    pnpm sync

# Show workspace status (branches, dirty state, behind count)
status:
    pnpm status

# Validate workspace integrity (singletons, overrides, manifests, engines)
validate:
    pnpm validate

# --- Build & Check ---

# Build all packages in topological order
build:
    pnpm turbo run build

# Build only packages affected by recent changes
build-affected:
    pnpm turbo run build --affected

# Type-check all packages
typecheck:
    pnpm turbo run typecheck

# Type-check only affected packages
typecheck-affected:
    pnpm turbo run typecheck --affected

# Run all plugin tests
test:
    pnpm turbo run test

# Run tests for a specific plugin
test-plugin name:
    pnpm turbo run test --filter=@quartz-community/{{name}}

# Lint all packages
lint:
    pnpm turbo run lint

# Run full check suite (typecheck + lint + format + test)
check:
    pnpm turbo run typecheck lint format:check test

# --- Quartz Live Server ---

# Build Quartz docs site and serve with live-reload (uses repos/quartz/docs as content)
serve:
    cd repos/quartz && node quartz/bootstrap-cli.mjs build --serve -d docs

# Build and serve with a custom content directory
serve-content dir:
    cd repos/quartz && node quartz/bootstrap-cli.mjs build --serve -d {{dir}}

# Build and serve on a custom port
serve-port port="8080":
    cd repos/quartz && node quartz/bootstrap-cli.mjs build --serve -d docs --port {{port}}

# Build Quartz site without serving (output to repos/quartz/public)
build-site:
    cd repos/quartz && node quartz/bootstrap-cli.mjs build -d docs

# --- Git (across repos) ---

# Check all repos, run full checks, then push repos with changes (ignores dist/ noise)
push: check
    #!/usr/bin/env bash
    set -euo pipefail
    pushed=0
    skipped=0
    failed=0
    for dir in repos/*/; do
        [ -d "$dir/.git" ] || continue
        name=$(basename "$dir")
        changes=$(git -C "$dir" status --porcelain -- ':!dist/')
        if [ -z "$changes" ]; then
            skipped=$((skipped + 1))
            continue
        fi
        echo "--- $name: pushing ---"
        if git -C "$dir" push 2>&1; then
            pushed=$((pushed + 1))
        else
            echo "!!! $name: push failed"
            failed=$((failed + 1))
        fi
    done
    echo ""
    echo "Pushed: $pushed, Skipped (clean): $skipped, Failed: $failed"
    [ "$failed" -eq 0 ]

# Show which repos have uncommitted changes (ignores dist/ rebuild noise)
dirty:
    #!/usr/bin/env bash
    for dir in repos/*/; do
        [ -d "$dir/.git" ] || continue
        name=$(basename "$dir")
        changes=$(git -C "$dir" status --porcelain -- ':!dist/')
        if [ -n "$changes" ]; then
            echo "=== $name ==="
            echo "$changes"
            echo ""
        fi
    done

# Show all changes including dist/ (for auditing full state)
dirty-all:
    #!/usr/bin/env bash
    for dir in repos/*/; do
        [ -d "$dir/.git" ] || continue
        name=$(basename "$dir")
        changes=$(git -C "$dir" status --porcelain)
        if [ -n "$changes" ]; then
            echo "=== $name ==="
            echo "$changes"
            echo ""
        fi
    done

# Restore dist/ to upstream state in all repos (undoes workspace build path differences)
restore-dist:
    #!/usr/bin/env bash
    for dir in repos/*/; do
        [ -d "$dir/.git" ] || continue
        git -C "$dir" checkout -- dist/ 2>/dev/null || true
    done
    echo "Restored dist/ in all repos"

# Commit all changes in a specific repo with a message (excludes dist/)
commit repo msg:
    git -C repos/{{repo}} add -A -- ':!dist/'
    git -C repos/{{repo}} commit -m "{{msg}}"

# --- Utilities ---

# Regenerate the turbo dependency graph from plugin package.json files
generate-graph:
    pnpm generate-turbo-graph

# Update dev.yaml with any new repos from the quartz-community org (requires gh + GITHUB_TOKEN)
sync-manifest:
    pnpm tsx scripts/sync-manifest.ts

# Build a single plugin
build-plugin name:
    pnpm turbo run build --filter=@quartz-community/{{name}}

# Clean turbo cache
clean-cache:
    rm -rf .turbo repos/*/.turbo

# Show the turbo task graph as a DOT file
graph:
    pnpm turbo run build --graph=/dev/stdout 2>/dev/null
