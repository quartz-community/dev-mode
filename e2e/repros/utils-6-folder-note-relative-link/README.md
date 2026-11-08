---
title: "Under relative, a link to a folder note by its own file name reaches no page"
issue: "quartz-community/utils#6"
plugins: [utils, crawl-links]
status: fixed # open | reproduced | fixed | wontfix
---

# Under `relative`, a link to a folder note by its own file name reaches no page

## Problem

`transformInternalLink` (utils) sets a link's `.`/`..` segments aside before `slugifyFilePath`, so
the folder-note rule only sees the segments the link spells out: `./Topic.md` written in
`notes/topic/Topic.md` (slug `notes/topic/index`) becomes `./topic`, i.e. `notes/topic/topic`,
which doesn't exist. Same for `Topic.md` / `./Topic.md` from a sibling note.

## Expected

Asserted by `repro.spec.ts`: every link reaches the folder note (the `../topic/Topic.md` case is a
control that already worked).

## Notes

Fix: utils `transformLink` (`relative`) resolves the target's folder against the source's folder
and, when the file name equals that folder (a folder note), links to the folder
(`_resolveRelativeFolderNote`), branch `dev-mode/heading-slugs` in repos/utils.
