---
name: css-change
description: Make and verify CSS / SCSS / layout / theme / component-markup changes to Quartz plugins, themes or core with before/after screenshots and a computed-style diff, across pages, viewports (desktop/tablet/mobile) and light/dark themes. Use for any visual or styling change, responsive/mobile layout bugs, theme color changes, or when asked how a page looks.
---

# CSS / visual changes

Two tools (both take a site target: `fixture:<name>`, `repro:<slug>`, `docs`, or a dir):

- `just inspect <target> [page…]` — one-off look at rendered pages: console/page errors, failed requests,
  **layout map** (each slot → child components with size/visibility), horizontal overflow, computed styles
  for `--selector`, `--html <sel>` outerHTML, `--screenshot` (PNG path printed — Read it to see the page).
  Options: `--viewport desktop|tablet|mobile|WxH`, `--theme light|dark`, `--click <sel>`, `--full-page`, `--json`.
- `just visual-baseline` / `just visual-check` — before/after regression: screenshots + computed-style
  snapshots for pages × viewports × themes, then a pixel diff **and a text diff of computed styles**
  (e.g. `` font-size: `28px` → `36px` — 20 elements, e.g. `[left] > h2.page-title` ``, CSS variable changes,
  moved/resized/appeared elements). Report: `.dev/visual/compare-base-head/report.md` (+ `report.html`
  side-by-side, `diff/*.png`). Exit 1 when something changed.

## Workflow

1. **Find the source.** Component roots carry `data-quartz-plugin` / `data-quartz-component` (shown as
   `← plugin/Component` in `just inspect`'s layout map). For inner classes: `just catalog dom <class>` → which
   plugin renders/styles it (and who else scripts or styles the same class). Theme variables come from `configuration.theme` and `repos/quartz-themes-core`.
2. **Baseline before editing:**
   `just visual-baseline --site fixture:bug-repro` (defaults: 5 discovered pages, desktop+mobile, light+dark;
   `--pages a,b`, `--all`, `--viewports desktop,tablet,mobile`, `--themes light`). ~30 s.
3. **Edit** the SCSS / inline `Component.css` / TSX.
4. **Rebuild the plugin:** `just build-plugin <name>` — Quartz uses `dist/`. (`visual-check` warns if a dist is stale.)
5. **Check:** `just visual-check` (reuses the baseline's site/pages/viewports). Read `report.md`:
   - intended changes should appear, and *only* those;
   - anything else (other components moving, mobile overflow, dark-mode contrast) is a regression.
   Open a few `diff/*.png` / head screenshots to sanity-check visually.
6. Iterate: edit → build-plugin → `just visual-check` (baseline stays as `base`).
7. Before committing, `just site-smoke <target>` (mobile overflow, console errors) and `just e2e`.

## Tips

- Want a specific scenario (long titles, deep explorer, callouts, tables)? Make a repro with that content and
  use `--site repro:<slug>`.
- Try a config/theme change without touching any repo: `--config <overlay.yaml>` with
  `extends: fixture:bug-repro` and `configuration: { theme: { colors: { lightMode: { secondary: "#c2185b" } } } }`.
- Quick before/after of a single selector: `just inspect <target> <page> --selector ".page-title" --viewport mobile`.
- Determinism: animations, transitions, caret and Date are frozen; canvas (graph) is masked magenta and not
  compared. Residual anti-aliasing noise is ≤ ~0.03% per shot, under the default 0.1% threshold — don't use
  `--threshold 0`. `--pixels-only` ignores style-snapshot diffs.
- Element keys use DOM order (`:nth()`), so inserting a sibling can show as "moved" for later siblings.
- Mobile layout: Quartz collapses sidebars into rows; check `--viewport mobile` explicitly — the bug-repro fixture
  currently squeezes Recent Notes beside the title on mobile (see
  `.dev/inspect/fixture-bug-repro/*-mobile-*.png`).
