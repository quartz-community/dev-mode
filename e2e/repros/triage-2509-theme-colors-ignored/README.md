---
title: "Config colours / --darkgray overrides ignored with @quartz-themes/core (#2509)"
issue: "jackyzha0/quartz#2509"
plugins: [quartz-themes-core]
status: wontfix # by design; documented in docs/configuration.md (theme colours)
---

# Config colours / --darkgray overrides ignored with @quartz-themes/core (#2509)

## Problem

The obsidian/ttrpg templates enable @quartz-themes/core. In dark mode its CSS colours text through Obsidian variables, so configuration.theme.colors and element-scoped Quartz vars (custom.scss) have no effect. Tested with tokyo-night (template default theme 'default' isn't installed in the workspace).

## Resolution

By design: a theme brings its own colour scheme. `docs/configuration.md` now explains this and shows how to override a theme's variables in `quartz/styles/custom.scss`; the spec checks that snippet.

## Steps

1. `just repro-check triage-2509-theme-colors-ignored` (strict) or `just site-serve repro:triage-2509-theme-colors-ignored`

## Expected

Asserted by repro.spec.ts.

## Actual

Light mode: config darkgray applies. Dark mode: p colour is the theme's rgb(169,177,214) for both config and scoped --darkgray overrides.

## Notes

Cause: theme CSS (layer obsidian-theme, static/resource-style-*.css) has `html[saved-theme="dark"] body p { color: var(--text-muted) }`, i.e. it maps to Obsidian vars, not Quartz vars. Largely by design; needs docs (disable the theme or override --text-normal/--text-muted) and maybe have themes defer to explicit configuration.theme.colors.
