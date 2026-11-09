---
title: "Folders holding only virtual pages get no folder page"
issue: "jackyzha0/quartz#2576"
plugins: [folder-page, bases-page, canvas-page]
status: fixed # open | reproduced | fixed | wontfix
---

# jackyzha0/quartz#2576 — folders of virtual pages

## Problem

A folder that contains only `.base` / `.canvas` files (rendered by bases-page / canvas-page as
virtual pages) got no folder page, so navigating up a level gave a 404. In a folder with both a
note and a `.base` file, the folder page listed only the note.

## Steps

1. `just site-serve repro:triage-2576-folder-virtual-pages`
2. Open `/trips/`, `/projects/`, `/projects/2026/`, `/boards/`, `/mixed/`

## Expected

Each is a folder page listing its `.base` / `.canvas` pages (and `mixed/` lists both).

## Actual (before the fix)

404 for the virtual-only folders; `mixed/` listed only `note`.

## Notes

Root cause, two parts:

- folder-page's `generate` collected folders only from `content` (source files). Virtual pages
  of other page types are not in `content`. Fix (folder-page): also read `ctx.virtualPages`,
  which core fills in priority order (bases/canvas 20 run before folder-page 10), skipping
  `tags/`. Folder listings fall back to `allFiles` when the folder is not in `ctx.trie`, and
  list a subfolder that has its own index page.
- core built `ctx.trie` (folder hierarchy for FolderContent and breadcrumbs) from source files
  only. Fix (core, dispatcher.ts `folderTrie`): add the virtual pages of page types that declare
  `fileExtensions` (file-backed: `.base`, `.canvas`, …) to the trie; tag/folder pages stay out.
