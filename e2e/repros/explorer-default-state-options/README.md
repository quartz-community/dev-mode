---
title: "Explorer ignores folderDefaultState and useSavedState"
issue: ""
plugins: [explorer]
status: reproduced # open | reproduced | fixed | wontfix
---

# Explorer ignores folderDefaultState and useSavedState

## Problem

With `folderDefaultState: open` folders still start closed, and with `useSavedState: false`
the state of each folder is still saved in `localStorage.fileTree` and restored after a
reload.

## Notes

`Explorer.tsx` renders the options as `data-collapsed` / `data-savestate` on `div.explorer`
(the control test checks they reach the page), but `explorer.inline.ts` (explorer 1.2.2 and
main) never reads them: `renderTree` defaults every folder to collapsed
(`savedState[node.slug] ?? true`), `toggleFolder` always writes `fileTree`, and
`handleNavOrRender` always reads it. A fix in the explorer plugin is in progress (unreleased
as of 2026-11-27); once released, this spec should pass → `status: fixed`.
