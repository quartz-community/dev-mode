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

- `npm-ahead` means the clone is stale — releasing from it would regress. `just sync` first.
- Dir ≠ npm name for some packages (`repos/fonts` = `@quartz-community/quartz-fonts`); the tools take dir or short names.
- Quartz core (`@jackyzha0/quartz`) is private: it isn't published, only its lockfile is updated.
- Syncer (`repos/syncer`) releases via GitHub releases (`version-bump.mjs` + tag), not npm — see `repos/syncer/AGENTS.md`.
- Legacy bulk tagging recipes (`just publish-tags`, `publish-tag`) push tags directly — avoid unless the user asks.
