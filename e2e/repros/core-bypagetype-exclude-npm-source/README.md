---
title: "byPageType.exclude never matches npm plugin sources"
issue: null
plugins: [reader-mode]
status: fixed   # open | reproduced | fixed | wontfix
---

# byPageType.exclude never matches npm plugin sources

## Problem
`quartz.config.default.yaml` (and the CLI templates) exclude `reader-mode` on folder and tag pages:

```yaml
layout:
  byPageType:
    folder: { exclude: [reader-mode], positions: { right: [] } }
    tag:    { exclude: [reader-mode], positions: { right: [] } }
```

Plugin sources are npm specifiers (`@quartz-community/reader-mode`). The loader compared the exclude
list against the name derived from the source — the full specifier — so nothing was excluded and the
reader-mode button rendered on every folder/tag page.

## Steps
1. `just repro-build core-bypagetype-exclude-npm-source`
2. Open `/tags/demo` or `/notes/`

## Expected
No `.readermode` button on tag/folder pages; it still renders on content pages (control).

## Actual (before fix)
`.readermode` rendered on tag and folder pages.

## Notes
Root cause: `loadQuartzLayout` matched `exclude` entries against `extractPluginName(source)`, which
returns the whole npm specifier. Fix (repos/quartz `config-loader.ts`, `buildQuartzLayout`): exclude
entries match either the source-derived name or the bare package name (`@scope/name` → `name`), and
an exclude entry that matches no plugin now prints a warning (with a "did you mean" hint).
Unit test: `quartz/plugins/loader/layout-diagnostics.test.ts` ("exclude matches npm specifiers").
