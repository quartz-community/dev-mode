---
title: "file.inFolder(this.file.folder) matches nothing in a base embedded in a note at the content root"
issue: "quartz-community/bases-page#19"
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# file.inFolder(this.file.folder) matches nothing in a root note

## Problem

`index.md` (content root) has an inline base filtering `file.inFolder(this.file.folder)`.
https://github.com/quartz-community/bases-page/issues/19

## Expected

Like Obsidian (root folder `/`, `inFolder("/")` true for every file): every note is listed,
including `notes/Deep`.

## Actual

"No data found": a root note's folder is `""` and `inFolder("")` returned false.

## Notes

Root cause: `inFolder` returned false for an empty argument. Fixed in bases-page
`dev-mode/this-context` (9cda99f): `""` and `"/"` mean the content root. The root folder is still
reported as `""` (Obsidian reports `"/"`), so `file.folder == "/"` filters still differ.
