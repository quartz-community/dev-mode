---
title: "Explorer folder rows get the slug, not the vault path, as data-path"
issue: ""
plugins: [explorer, folder-page]
status: reproduced # open | reproduced | fixed | wontfix
---

# Explorer folder rows get the slug as data-path

## Problem

With the default plugins, the folder `Notes/Daily Notes/` shows in the explorer as
`<div class="folder-container" data-path="notes/daily-notes">`; Obsidian (and themes keyed on
it, `.nav-folder-title[data-path="Notes/Daily Notes"]`) uses the vault path,
`Notes/Daily Notes`. File links are right (`Notes/Daily Notes/2026-11-26.md`).

## Notes

`folderVaultPath(node)` in `explorer.inline.ts` (explorer 1.2.2 and main) takes the first
`filePath` found breadth-first from the folder node, and the first is the folder's own
`index` entry. Folder pages the folder-page plugin generates (virtual pages) have a
`filePath` built from the slug (`notes/daily-notes/index.md`, see `contentIndex.json`), so the
folder row gets `notes/daily-notes`. Fix: skip virtual pages (or entries whose `filePath`
is the slug) and use a real file under the folder; or have virtual folder pages carry the
folder's real path.

With `folder-page` disabled (no virtual folder pages) the spec passes.
