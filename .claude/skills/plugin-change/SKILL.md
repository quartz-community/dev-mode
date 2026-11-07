---
name: plugin-change
description: Make and verify a change to a Quartz v5 plugin, infrastructure package (types, utils, runtime, remark-obsidian, rehype-obsidian), theme, or Quartz core in this dev-mode workspace — scoping impact, editing, rebuilding, testing on a real rendered site, and committing per-repo. Use for any code change under repos/.
---

# Changing a plugin (or infra / core)

Every `repos/<name>` is an **independent git repo and npm package**. dev-mode only links them together
(pnpm workspace + `.pnpmfile.cjs`); plugins must keep working standalone.

## 1. Scope before editing

- `just catalog show <plugin>` — hooks, components + default positions, data keys provided/consumed, CSS classes, client scripts.
- `just catalog impact <package>` — transitive dependents, fixtures/repros that enable it, specs that touch it, and
  the verification commands to run. Infra changes (`types`, `utils`) ripple to 40+ packages.
- Data contracts between plugins live in `file.data` (vfile). Before renaming/removing a key:
  `just catalog who-reads <key>`. See the `plugin-dataflow` skill.
- Dir name ≠ npm name sometimes (`repos/fonts` = `@quartz-community/quartz-fonts`). `just build-plugin`/`test-plugin`
  take the **npm short name**.

## 2. Plugin anatomy

```
repos/<name>/
  package.json      "quartz" field = manifest: category, defaultOrder, defaultOptions, components{defaultPosition}
  src/index.ts      exports factory (transformer/filter/emitter/pageType) and/or components
  src/components/   *.tsx (Preact), scripts/*.inline.ts (browser), styles/*.scss
  src/i18n/         locale strings
  test/ or src/**/*.test.ts   vitest
  dist/             tsup output — WHAT QUARTZ ACTUALLY LOADS
```
Transformers run in `defaultOrder` (lower first; overridable per site with `order:`).

## 3. Edit → rebuild → check

```bash
just build-plugin <name>        # REQUIRED: Quartz loads dist/, not src/
just test-plugin <name>         # unit tests
just typecheck                  # after any exported type / interface change (all packages)
```
Keep `just watch` running in the background to rebuild on save instead.
Site builds print `⚠ <name>: dist/ is older than src/` when you forget to rebuild.

## 4. See it on a real site

```bash
just site-build fixture:bug-repro          # isolated sandbox build → .dev/sites/fixture-bug-repro
just inspect fixture:bug-repro <page> --screenshot   # console errors, layout map, computed styles, PNG
just site-serve fixture:bug-repro          # click around (production-like static server)
```
Need a specific scenario? Make a repro (`reproduce-bug` skill) — `just repro-new <slug> --plugin <name>`.
Visual/CSS changes: use the `css-change` skill (before/after screenshots + computed-style diff).

## 5. Full verification

```bash
just build-affected && just check     # typecheck + lint + format:check + test (what `just push` runs)
just e2e                              # fixtures + suites + repros
```
Format with `npm run format` in the repo if `format:check` fails (prettier ^3.8.1 pinned workspace-wide).

## 6. Commit (per repo, never raw git)

```bash
just dirty                                    # what changed where (ignores dist/)
just commit-files <repo> "fix(x): ..." src/a.ts test/a.test.ts   # preferred: only your files
just commit <repo> "fix(x): ..."              # stages everything except dist/
```
Repos may have unrelated pre-existing changes (e.g. `.gitignore`) — use `commit-files` to avoid sweeping them in.
Add a changeset for user-facing changes: `just release-changeset --bump <type> --summary "<text>" <pkg…>`
— this includes Quartz core (`quartz`); never `npx changeset` inside `repos/quartz` (it finds the
workspace root). Releasing is separate: see the `release-plugins` skill. Pushing (`just push`, `just push-repo`) is outward-facing —
ask the user first.

## Cross-repo changes

Bottom-up: `types` → `utils` → `runtime`/`remark-obsidian`/`rehype-obsidian` → plugins → core.
Rebuild with `just build-affected`; run `just typecheck` and `just validate` (singletons, overrides) after dependency changes.
Quartz core quirk: `Head.tsx` imports the generated `.quartz/plugins/index.ts` — sandboxed builds handle this automatically.
