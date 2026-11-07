set dotenv-load := false

# List available commands
default:
    @just --list

# One-screen orientation: toolchain, browser, dirty repos, stale dist/, generated artifacts
overview *args:
    @pnpm tsx scripts/overview.ts {{args}}

# --- Setup & Teardown ---

# Verify development prerequisites (Node 22+, pnpm 10+, git)
check-env:
    @pnpm tsx scripts/check-env.ts

# Clone repos and set up workspace (preset: minimal, content-pipeline, ui, full)
setup preset="full": check-env
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

# Diagnose published dependency reachability, lockfiles, and clean installs
doctor:
    pnpm doctor

# --- Build & Check ---

# Build all packages in topological order
build:
    pnpm turbo run build

# List packages with local changes (uncommitted source edits or unpushed commits)
changed *args:
    @pnpm tsx scripts/changed.ts {{args}}

# Build packages with local changes + their dependents (turbo --affected is blind here: repos/ is git-ignored at the root)
build-affected:
    pnpm tsx scripts/changed.ts run build

# Test packages with local changes + their dependents
test-affected:
    pnpm tsx scripts/changed.ts run test

# Type-check all packages
typecheck:
    pnpm turbo run typecheck

# Type-check packages with local changes + their dependents
typecheck-affected:
    pnpm tsx scripts/changed.ts run typecheck

# Run unit tests for workspace scripts
test-unit:
    pnpm vitest run

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

# Watch for changes and rebuild affected packages
watch:
    pnpm turbo watch build

# Watch + serve Quartz with live-reload (full dev loop)
dev: generate-dev-config
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'just clean-dev-config; kill $TURBO_PID 2>/dev/null || true' EXIT
    pnpm turbo watch build &
    TURBO_PID=$!
    cd repos/quartz && node quartz/bootstrap-cli.mjs build --serve -d docs
    wait $TURBO_PID

# --- Quartz Live Server ---

# Generate quartz.config.yaml with local path plugin specifiers for dev-mode
[private]
generate-dev-config:
    #!/usr/bin/env bash
    node -e "
    const fs = require('fs');
    const path = require('path');
    const yaml = require('yaml');
    const pkgNameToDir = new Map();
    for (const dir of fs.readdirSync('repos', { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const pkgPath = path.join('repos', dir.name, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) pkgNameToDir.set(pkg.name, dir.name);
      } catch {}
    }
    const config = yaml.parse(fs.readFileSync('repos/quartz/quartz.config.default.yaml', 'utf-8'));
    config.plugins = config.plugins.map(entry => {
      const source = entry.source;
      if (typeof source === 'string') {
        let npmName;
        if (source.startsWith('github:quartz-community/')) {
          npmName = '@quartz-community/' + source.replace('github:quartz-community/', '');
        } else if (source.startsWith('@quartz-community/')) {
          npmName = source;
        }
        if (npmName) {
          const dirName = pkgNameToDir.get(npmName);
          if (dirName) return { ...entry, source: '../' + dirName };
        }
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

# Check all repos, run full checks, then push repos with uncommitted or unpushed changes (ignores dist/ noise)
push: check
    #!/usr/bin/env bash
    set -euo pipefail
    pushed=0
    skipped=0
    failed=0
    for dir in repos/*/; do
        [ -d "$dir/.git" ] || continue
        name=$(basename "$dir")
        uncommitted=$(git -C "$dir" status --porcelain -- ':!dist/')
        tracking=$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "")
        if [ -n "$tracking" ]; then
            unpushed=$(git -C "$dir" log "$tracking..HEAD" --oneline 2>/dev/null || echo "")
        else
            unpushed=""
        fi
        if [ -z "$uncommitted" ] && [ -z "$unpushed" ]; then
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
    git -C repos/{{repo}} add --all --ignore-errors -- . ':!dist/'
    git -C repos/{{repo}} commit -m "{{msg}}"

# Commit specific files in a repo (stages ONLY the listed paths)
commit-files repo msg +files:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -d "repos/{{repo}}/.git" ] || { echo "Not a git repo: repos/{{repo}}"; exit 1; }
    git -C "repos/{{repo}}" diff --cached --quiet || { echo "Refusing to include pre-existing staged changes"; exit 1; }
    git -C "repos/{{repo}}" add -- {{files}}
    git -C "repos/{{repo}}" commit -m "{{msg}}" -- {{files}}

# Push a single repo (does not touch other repos)
push-repo repo: check
    git -C repos/{{repo}} push

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

# Plan the coordinated @quartz-community/* 1.0 migration (writes nothing)
migrate-v1-plan:
    pnpm migrate-to-v1 --plan

# Deploy Changesets to all plugin repos
deploy-changesets:
    pnpm tsx scripts/deploy-changesets.ts

deploy-changesets-dry:
    pnpm tsx scripts/deploy-changesets.ts --dry-run

# --- Releases (local prep only; pushing/merging/publishing stays manual) ---

# What needs releasing across the ecosystem (versions vs npm, changesets, unpushed, lockfile)
release-status *args:
    pnpm tsx scripts/release.ts status {{args}}

# Ordered release plan for a set of packages, incl. dependents that must follow (--bump patch|minor|major)
release-plan +args:
    pnpm tsx scripts/release.ts plan {{args}}

# Write the same changeset into several repos: --bump patch --summary "..." <pkg...>
release-changeset +args:
    pnpm tsx scripts/release.ts changeset {{args}}

# Pre-flight a release set: build/typecheck/lint/format/test for packages + dependents
release-verify +args:
    pnpm tsx scripts/release.ts verify {{args}}

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
    trap 'rm -rf "$tmp"' EXIT
    cp "$dir/package.json" "$tmp/package.json"
    [ ! -f "$dir/.npmrc" ] || cp "$dir/.npmrc" "$tmp/.npmrc"
    (cd "$tmp" && npm install --ignore-scripts --prefer-online)
    pnpm tsx scripts/doctor.ts --skip-network --integrity-only --lockfile "$tmp/package-lock.json"
    cp "$tmp/package-lock.json" "$dir/package-lock.json"
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
        cleanup() { rm -rf "$tmp"; }
        trap cleanup EXIT
        cp "$dir/package.json" "$tmp/package.json"
        [ ! -f "$dir/.npmrc" ] || cp "$dir/.npmrc" "$tmp/.npmrc"
        (cd "$tmp" && npm install --ignore-scripts --prefer-online)
        if [ -f "$tmp/package-lock.json" ]; then
            pnpm tsx scripts/doctor.ts --skip-network --integrity-only --lockfile "$tmp/package-lock.json"
            cp "$tmp/package-lock.json" "$dir/package-lock.json"
            count=$((count + 1))
        fi
        cleanup
        trap - EXIT
    done
    echo "Regenerated $count lockfiles (standalone)"

# Build a single plugin
build-plugin name:
    pnpm turbo run build --filter=@quartz-community/{{name}}

# Regenerate quartz lockfile and commit (run after plugin releases land on npm)
update-quartz-lockfile:
    #!/usr/bin/env bash
    set -euo pipefail
    just regen-lockfile quartz
    if git -C repos/quartz diff --quiet package-lock.json 2>/dev/null; then
        echo "Lockfile unchanged — nothing to update"
        exit 0
    fi
    git -C repos/quartz diff --stat -- package-lock.json
    git -C repos/quartz add package-lock.json
    git -C repos/quartz commit -m "chore: update lockfile for latest plugin releases"
    echo "Committed. Run 'just push' to push."

# Remove all generated dev-mode scratch output (.dev/: sandboxes, sites, catalog, visual, traces, logs)
clean-dev:
    rm -rf .dev

# Clean turbo cache
clean-cache:
    rm -rf .turbo repos/*/.turbo

# Show the turbo task graph as a DOT file
graph:
    pnpm turbo run build --graph=/dev/stdout 2>/dev/null

# --- E2E Tests ---

# Build E2E fixtures in isolated sandboxes (default: all, in parallel)
e2e-build +fixtures="all":
    pnpm tsx e2e/helpers/build-fixture.ts {{fixtures}}

# Run E2E tests (requires fixtures to be built first); extra args go to playwright
e2e-test *args:
    pnpm exec playwright test --config e2e/playwright.config.ts {{args}}

# Full E2E: build all fixtures + run tests + run repros
e2e: (e2e-build "all")
    @just e2e-test
    @just repro-test

# Install Playwright browser binaries (not needed if using Nix)
install-browsers:
    pnpm exec playwright install chromium

# Show which Chromium binary E2E tooling will use (and why)
which-browser:
    @pnpm tsx -e "import('./scripts/lib/browser.ts').then(m => console.log(JSON.stringify(m.resolveChromium(), null, 2)))"

# --- Sites (isolated sandboxes; never touch repos/quartz) ---
# <target>: fixture:<name> | repro:<slug> | docs | <dir>   (just site-targets)

# List buildable site targets (fixtures and repros)
site-targets:
    pnpm tsx scripts/site.ts targets

# Build a site target into .dev/sites/<id> (warns about stale plugin dist/)
site-build target *args:
    pnpm tsx scripts/site.ts build {{target}} {{args}}

# Build and serve a site target statically (production-like, honours base path)
site-serve target *args:
    pnpm tsx scripts/site.ts serve {{target}} {{args}}

# Quartz live-reload server for a site target, in a sandbox
site-dev target *args:
    pnpm tsx scripts/site.ts dev {{target}} {{args}}

# Whole-site smoke test: broken links/assets, console + page errors, SPA errors, mobile overflow
site-smoke target *args:
    pnpm tsx scripts/smoke.ts {{target}} {{args}}

# Print the fully resolved quartz.config.yaml for a target (after overlays)
site-config target *args:
    pnpm tsx scripts/site.ts config {{target}} {{args}}

# Plugin catalog: build | show <pkg> | who-writes <key> | who-reads <key> | impact <pkg> | dom <class> | search <text>
catalog *args:
    pnpm tsx scripts/catalog.ts {{args}}

# Runtime data-flow trace of a real build: who reads/writes which file.data key (prototype)
trace site="fixture:bug-repro" *args:
    pnpm tsx scripts/trace.ts --site {{site}} {{args}}

# Inspect rendered page(s): errors, layout map, computed styles, screenshot (--screenshot, --selector, --viewport mobile, --theme dark)
inspect *args:
    pnpm tsx scripts/inspect.ts {{args}}

# Visual regression: capture <label> | compare <a> <b> | baseline | check
visual *args:
    pnpm tsx scripts/visual.ts {{args}}

# Capture the "base" visual snapshot (screenshots + computed styles) before a CSS/UI change
visual-baseline *args:
    pnpm tsx scripts/visual.ts baseline {{args}}

# Capture "head" and compare against "base": pixel diff + text style diff report (exit 1 on change)
visual-check *args:
    pnpm tsx scripts/visual.ts check {{args}}

# --- Repros (e2e/repros/<slug>: content + config overlay + Playwright spec) ---

# Scaffold a new repro (e.g. just repro-new 2490-mermaid-spa --issue jackyzha0/quartz#2490 --plugin graph)
repro-new slug *args:
    pnpm tsx scripts/repro.ts new {{slug}} {{args}}

# List repros with status
repro-list:
    pnpm tsx scripts/repro.ts list

# Build a repro site
repro-build slug *args:
    pnpm tsx scripts/repro.ts build {{slug}} {{args}}

# Run repro specs (all, or one slug)
repro-test slug="" *args:
    pnpm tsx scripts/repro.ts test {{slug}} {{args}}

# Build + test one repro; add --expect-fail to confirm it reproduces the bug
repro-check slug *args:
    pnpm tsx scripts/repro.ts check {{slug}} {{args}}
