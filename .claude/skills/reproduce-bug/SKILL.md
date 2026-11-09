---
name: reproduce-bug
description: Reproduce a Quartz / Quartz-plugin bug report as a minimal, self-contained, executable repro (content + config overlay + Playwright spec) in this dev-mode workspace, confirm it fails, then verify a fix. Use when given a GitHub issue, a bug description, "X renders wrong", "Y breaks after SPA navigation", or asked to investigate/triage/fix a rendering or build bug.
---

# Reproduce a Quartz bug

A repro is a directory `e2e/repros/<slug>/`:

```
README.md            frontmatter: title, issue, plugins, status (open|reproduced|fixed|wontfix)
quartz.config.yaml   OVERLAY on the default config (or a fixture) — only what the bug needs
content/             the smallest vault that triggers the bug
repro.spec.ts        Playwright test asserting the EXPECTED behaviour
```

It builds in an isolated sandbox (never touches `repos/quartz`), serves on a free
port, and runs via `e2e/playwright.repros.config.ts`. ~3-5 s per build.

## Workflow

1. **Understand the report.** Identify the plugin(s) involved. If unsure which plugin
   renders an element or provides data: `just catalog dom <class>`, `just catalog who-writes <key>`,
   `just catalog show <plugin>` (see the `plugin-dataflow` skill).
2. **Scaffold:** `just repro-new <issue#>-<short-slug> --issue jackyzha0/quartz#<n> --plugin <name>`
   - `--from fixture:bug-repro` to start from the full-featured fixture config instead of the default.
3. **Minimise the config overlay** (`quartz.config.yaml`). Keys:
   - `extends: default | fixture:<name> | <path>`
   - `configuration:` deep-merged (e.g. `baseUrl: localhost/sub` to test base-path bugs, `enableSPA: false`)
   - `only: [a, b]` enable only these plugins · `enable: [...]` · `disable: [...]`
   - `plugins: { <name>: { options: {...}, layout: { position: left } } }` patch per plugin
   - Check the result: `just site-config repro:<slug>`
4. **Write minimal content** in `content/`. Copy the reporter's markdown verbatim first, then cut it down.
5. **Write the spec** asserting the *correct* behaviour. Use the fixtures from `../../helpers/repro-fixture`:
   - `site.url("path/to/page")` (handles base path), `pageProblems.all()` (console errors, page errors, HTTP ≥ 400).
   - For SPA bugs: navigate by clicking an internal link (`a.internal`), then assert — direct loads and SPA
     navigations exercise different code paths.
6. **Confirm it reproduces:** `just repro-check <slug> --expect-fail` (exits 0 only if the spec FAILS).
   If it passes, the repro doesn't capture the bug — revisit content/config. Look at the page:
   `just inspect repro:<slug> <page> --screenshot` then Read the PNG.
   Set README `status: reproduced`.
7. **Fix** in `repos/<plugin>/src/`, then `just build-plugin <plugin>` — Quartz consumes plugin **dist/**,
   so builds warn `⚠ <plugin>: dist/ is older than src/` when you forget. Infra packages
   (`utils`, `types`, `remark-obsidian`, …) also need rebuilding; `just build-affected` covers dependents.
8. **Verify:** `just repro-check <slug>` passes; then `just test-plugin <plugin>` and `just e2e` for regressions.
   Set README `status: fixed`, record root cause + fix in README Notes.
9. **Upstream:** a repro is dev-mode-only. If the plugin repo has unit tests, add a unit test there too
   (that's what ships with the fix). Commit plugin changes with `just commit <repo> "<msg>"`; never raw git.

## Status semantics (README frontmatter)

- `open` / `reproduced` → the fixture marks the spec **expected to fail**, so `just e2e` / CI stay green
  while the bug is unfixed. When a fix lands, Playwright reports *"expected to fail, but passed"* — that's
  your cue to set `status: fixed`.
- `fixed` / `wontfix` → normal test (a regression guard).
- Tests titled `control: …` are sanity checks and are never marked expected-to-fail.
- `just repro-check` always runs strict (`REPRO_STRICT=1`), ignoring status.
- A freshly scaffolded repro is `open` with a trivial passing spec → it will show as "expected to fail, but
  passed" until you write a spec that actually captures the bug. That's intentional.

## Whole-site discovery

`just site-smoke <target>` crawls a built site (broken links/assets, console/page errors, errors after SPA
navigation, mobile overflow). Good for finding bugs to repro, and for checking a user's real vault: point it
at a dir containing `content/` (+ optional `quartz.config.yaml` overlay). Examples it found on
`fixture:bug-repro`: `e2e/repros/ofm-svg-embed-404`, `e2e/repros/ofm-mermaid-needs-clipboard`.

## Gotchas

- Build output dates come from file mtimes — don't assert on exact dates unless set in frontmatter.
- Content placed under `.dev/` is gitignored and Quartz will skip it (`gitignore: true` globbing). Keep repro content in `e2e/repros/`.
- `just site-serve repro:<slug>` to click around manually; `just site-dev repro:<slug>` for Quartz's live-reload server.
- Build logs: `.dev/logs/build-repro-<slug>.log`. Failure traces: `.dev/test-results/repros/`.
- Fixture-based tests (`e2e/tests/*.spec.ts`) are for long-lived regression suites; repros are cheaper to add. See the `write-e2e-test` skill.
