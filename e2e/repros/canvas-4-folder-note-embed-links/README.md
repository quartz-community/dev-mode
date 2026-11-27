---
title: "Links inside an embedded folder note resolve one directory too high"
issue: "quartz-community/canvas-page#4"
plugins: [canvas-page]
status: fixed # quartz-community/utils#19 merged 2026-11-26 (on npm: canvas-page 1.1.4 bundles it)
---

# Links inside an embedded folder note resolve one directory too high (quartz-community/canvas-page#4)

## Problem

A canvas file node embedding a folder note (`folder/index.md`) rewrites every relative link in the
embedded HTML one directory too high. Invisible at the domain root (the browser clamps `..`); under a
base path (`baseUrl: localhost/docs`) the links escape it: `/other` instead of `/docs/other`.

## Steps

1. `just site-serve repro:canvas-4-folder-note-embed-links`
2. Open `/docs/board.canvas`, look at the links in the "Folder" card.

## Expected

`/docs/other`, `/docs/folder/inside` (as in the "Other" card, which embeds an ordinary page).

## Actual

`/other`, `/folder/inside` (404).

## Notes

Root cause in `@quartz-community/utils` `normalizeHastElement` → `_rebaseHastElement`:
`joinSegments(resolveRelative(curBase, newBase), "..", href)`. `resolveRelative` runs `newBase` through
`simplifySlug`, which strips a trailing `index`, so the `..` meant to drop the page's own filename
removes a real directory. Fix (utils branch `dev-mode/folder-note-rebase`): take the directory from the
raw slug, `joinSegments(pathToRoot(curBase), dirname(newBase), href)`.

canvas-page bundles utils into its `dist/` (tsup `noExternal`), so it needs a rebuild + patch release
after the utils release. Quartz core's transclusions use the same function (unbundled) and are fixed by
the utils bump alone.
