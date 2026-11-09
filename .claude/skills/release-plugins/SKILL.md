---
name: release-plugins
description: Plan and prepare releases of one or many Quartz plugins / infrastructure packages (changesets, dependency order, dependents, npm publish, Quartz lockfile update) in this dev-mode workspace. Use when asked what needs releasing, to release/publish/bump plugins, to add changesets, or after merging fixes that should ship.
---

# Releasing plugins

Each `repos/<name>` publishes independently to npm via **changesets + CI**:
changeset committed on `main` → push → CI opens a "Version Packages" PR (`changeset-release/main`) →
merge → CI publishes → `just update-quartz-lockfile` in Quartz core → push.
Tooling here does the **local** prep. Anything outward-facing (push, merge PR, tag, publish) needs the user's OK.

## 1. Where are we?

```bash
just release-status            # every repo: local vs npm version, changesets, unpushed, commits since release
just release-status graph explorer --json
just release-status --offline  # skip npm lookups
```
Statuses: `clean`, `needs-changeset` (releasable commits, no changeset), `ready` (changeset pending),
`needs-version-bump`, `version-bumped-unpublished`, `npm-ahead` (pull first! `just sync`), `lockfile-stale`, `dirty`.
Non-release noise (e.g. modified `.gitignore`) is ignored.
The summary ends with **lockfile drift** (same data as `just drift`, below).

```bash
just ci-status                 # latest CI per workflow on every repo's default branch; exit 1 if any fails
just ci-status --prs           # + open PRs' check state ("no-checks (version PR …)" = never tested)
just ci-status tui graph --json
```
Run it before releasing: a red default branch (e.g. tui's CI, red unnoticed for months) means the
release CI may fail too or publish untested code. It only reads (`gh api`, `gh pr list`).

```bash
just drift                     # repo package-lock.json vs workspace pnpm resolution, major/minor only
just drift quartz-themes-core --all
just drift --ignore '@types/*,sass*'   # filter noise; --strict exits 1 on drift
```
Workspace tests run against pnpm's versions; the repo's own CI runs against its `package-lock.json`.
Drift in one or two repos (sorted first) is the kind that broke themes-core's CI (lucide 1.26 vs 1.70).
Fix: refresh the lockfile in that repo (`npm install --package-lock-only`, inside `nix develop`) and run
its CI-equivalent checks with npm (`npm ci && npm run check`) before releasing. Widespread drift (`@types/node`
in every repo) just means lockfiles are old.

## 2. Plan the set

```bash
just release-plan graph explorer --bump patch
just release-plan types --bump major          # shows the dependents that must follow, in waves
```
The plan is topologically ordered (types → utils → runtime/remark/rehype → plugins → Quartz lockfile),
adds dependents whose ranges would exclude the new version (caret ranges: only majors usually cascade),
and labels each step `[LOCAL]`, `[NET]` (read-only/wait), or `[ASK]` (outward-facing — confirm with the user).

## 3. Prepare

```bash
just release-verify graph explorer            # build/typecheck/lint/format/test for the set + dependents
just release-changeset --bump patch --summary "Fix explorer collapse state after SPA nav" explorer graph
just commit-files explorer "chore: add changeset" .changeset/<file>.md
```
Changeset summaries become CHANGELOG entries — write them for site owners (what changed, any migration).
`major` for breaking config/option/data-key changes; `minor` for new options/features; `patch` for fixes.

## 4. Ship (ask first)

Follow the plan's `[ASK]` steps only after the user agrees, e.g. `just push-repo explorer`
(runs `just check` first), then merging the Version Packages PR. Wait for npm:
`pnpm tsx scripts/release.ts wait-npm @quartz-community/explorer@1.0.2`, then `just update-quartz-lockfile`
and (with approval) `just push-repo quartz`.

## Gotchas

- Version PRs ("chore: version package") get **no CI**: changesets/action pushes them with `GITHUB_TOKEN`,
  which triggers no workflows, so the lockfile `version-packages` rewrites is merged untested. `just ci-status --prs`
  flags them. Prototype fix (release.yml runs ci.yml on the PR head and posts a `CI / version PR` status):
  `repos/note-properties` branch `dev-mode/version-pr-ci`. Until it is rolled out, check a version PR locally
  (`git checkout changeset-release/main && npm ci && npm run check` in the repo) before merging.
- `npm-ahead` means the clone is stale — releasing from it would regress. `just sync` first.
- Dir ≠ npm name for some packages (`repos/fonts` = `@quartz-community/quartz-fonts`); the tools take dir or short names.
- Quartz core (`@jackyzha0/quartz`) is not on npm, but is versioned with changesets since 5.1: add a
  `.changeset/*.md` in `repos/quartz` for user-facing changes (`"@jackyzha0/quartz": minor`); on `v5` CI
  opens a "chore: release Quartz" PR, and merging it tags `vX.Y.Z` + creates a GitHub release
  (`.github/workflows/release.yaml`). Its lockfile is still updated after plugin releases. Note: inside
  this workspace `npx changeset` finds the pnpm root instead of repos/quartz — never run it there; use
  `just release-changeset --bump minor --summary "…" quartz` (`--dry-run` to preview) or write the file
  by hand. Release tags start at `v5.0.0`; if `git -C repos/quartz describe --match 'v*'` fails, the
  clone is shallow: `git -C repos/quartz fetch --unshallow --tags`.
- Plugins that need a newer Quartz must raise `quartz.quartzVersion` (semver range, e.g. `">=5.1.0"`);
  Quartz enforces it at build (warning locally, failure in CI) / `plugin add` / `plugin doctor`. Only
  raise it once that core version is released (until then core's package.json still says the old
  version); release the change as a plugin minor/major.
- Syncer (`repos/syncer`) releases via GitHub releases (`version-bump.mjs` + tag), not npm — see `repos/syncer/AGENTS.md`.
- Legacy bulk tagging recipes (`just publish-tags`, `publish-tag`) push tags directly — avoid unless the user asks.
