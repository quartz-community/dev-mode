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

# Generate quartz.config.yaml with local path plugin specifiers for dev-mode
[private]
generate-dev-config:
    #!/usr/bin/env bash
    node -e "
    const fs = require('fs');
    const yaml = require('yaml');
    const config = yaml.parse(fs.readFileSync('repos/quartz/quartz.config.default.yaml', 'utf-8'));
    config.plugins = config.plugins.map(entry => {
      const source = entry.source;
      if (typeof source === 'string') {
        let name;
        if (source.startsWith('github:quartz-community/')) {
          name = source.replace('github:quartz-community/', '');
        } else if (source.startsWith('@quartz-community/')) {
          name = source.replace('@quartz-community/', '');
        }
        if (name) return { ...entry, source: '../' + name };
      }
      return entry;
    });
    fs.writeFileSync('repos/quartz/quartz.config.yaml', yaml.stringify(config, { lineWidth: 0 }));
    "

# Remove generated dev config to keep repos/quartz clean
[private]
clean-dev-config:
    rm -f repos/quartz/quartz.config.yaml

# Build Quartz docs site and serve with live-reload (uses repos/quartz/docs as content)
serve: generate-dev-config
    -cd repos/quartz && node quartz/bootstrap-cli.mjs build --serve -d docs
    @just clean-dev-config

# Build and serve with a custom content directory
serve-content dir: generate-dev-config
    -cd repos/quartz && node quartz/bootstrap-cli.mjs build --serve -d {{dir}}
    @just clean-dev-config

# Build and serve on a custom port
serve-port port="8080": generate-dev-config
    -cd repos/quartz && node quartz/bootstrap-cli.mjs build --serve -d docs --port {{port}}
    @just clean-dev-config

# Build Quartz site without serving (output to repos/quartz/public)
build-site: generate-dev-config
    cd repos/quartz && node quartz/bootstrap-cli.mjs build -d docs
    @just clean-dev-config

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

# Migrate plugin repos to npm publishing
migrate-npm:
    pnpm migrate-to-npm

# Migrate plugin repos to npm publishing (dry run)
migrate-npm-dry:
    pnpm migrate-to-npm -- --dry-run

# Tag all repos with their current version to trigger CI publish (infrastructure first, then plugins)
publish-tags:
    #!/usr/bin/env bash
    set -euo pipefail
    infra="types utils runtime rehype-obsidian remark-obsidian"
    echo "=== Phase 1: infrastructure ==="
    for name in $infra; do
        dir="repos/$name"
        [ -d "$dir/.git" ] || continue
        version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$dir/package.json')).version)")
        tag="v$version"
        if git -C "$dir" tag -l "$tag" | grep -q "$tag"; then
            echo "  $name: $tag already exists, skipping"
            continue
        fi
        git -C "$dir" tag -a "$tag" -m "Release $tag"
        git -C "$dir" push origin "$tag"
        echo "  $name: tagged and pushed $tag"
    done
    echo ""
    echo "Waiting 30s for npm registry propagation..."
    sleep 30
    echo ""
    echo "=== Phase 2: plugins ==="
    for dir in repos/*/; do
        [ -d "$dir/.git" ] || continue
        name=$(basename "$dir")
        [ "$name" = "quartz" ] && continue
        echo "$infra" | grep -wq "$name" && continue
        version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$dir/package.json')).version)")
        tag="v$version"
        if git -C "$dir" tag -l "$tag" | grep -q "$tag"; then
            echo "  $name: $tag already exists, skipping"
            continue
        fi
        git -C "$dir" tag -a "$tag" -m "Release $tag"
        git -C "$dir" push origin "$tag"
        echo "  $name: tagged and pushed $tag"
    done
    echo ""
    echo "Done. CI will publish packages as workflows complete."

# Tag a single repo with its current version to trigger CI publish
publish-tag name:
    #!/usr/bin/env bash
    set -euo pipefail
    dir="repos/{{name}}"
    version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$dir/package.json')).version)")
    tag="v$version"
    git -C "$dir" tag -a "$tag" -m "Release $tag"
    git -C "$dir" push origin "$tag"
    echo "{{name}}: tagged and pushed $tag — CI will publish"

# Regenerate package-lock.json outside the pnpm workspace (for CI compatibility)
regen-lockfile name:
    #!/usr/bin/env bash
    set -euo pipefail
    dir="repos/{{name}}"
    [ -d "$dir" ] || { echo "Not found: $dir"; exit 1; }
    tmp=$(mktemp -d)
    cp -r "$dir" "$tmp/pkg"
    (cd "$tmp/pkg" && rm -f package-lock.json && npm install --ignore-scripts --package-lock-only 2>&1 | tail -2)
    cp "$tmp/pkg/package-lock.json" "$dir/package-lock.json"
    rm -rf "$tmp"
    echo "Regenerated $dir/package-lock.json (standalone)"

# Regenerate package-lock.json for ALL plugin repos outside the workspace
regen-lockfiles:
    #!/usr/bin/env bash
    set -euo pipefail
    count=0
    for dir in repos/*/; do
        [ -d "$dir/.git" ] || continue
        name=$(basename "$dir")
        [ "$name" = "quartz" ] && continue
        [ -f "$dir/package.json" ] || continue
        tmp=$(mktemp -d)
        cp -r "$dir" "$tmp/pkg"
        (cd "$tmp/pkg" && rm -f package-lock.json && npm install --ignore-scripts --package-lock-only 2>/dev/null 1>/dev/null)
        if [ -f "$tmp/pkg/package-lock.json" ]; then
            cp "$tmp/pkg/package-lock.json" "$dir/package-lock.json"
            count=$((count + 1))
        fi
        rm -rf "$tmp"
    done
    echo "Regenerated $count lockfiles (standalone)"

# Build a single plugin
build-plugin name:
    pnpm turbo run build --filter=@quartz-community/{{name}}

# Clean turbo cache
clean-cache:
    rm -rf .turbo repos/*/.turbo

# Show the turbo task graph as a DOT file
graph:
    pnpm turbo run build --graph=/dev/stdout 2>/dev/null
