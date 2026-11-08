---
title: "Quartz's generated 404 page (and other virtual pages) appear as notes in base views"
issue: "quartz-community/bases-page#20"
plugins: [bases-page, tag-page, folder-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Virtual pages appear as notes in base views

## Problem

Quartz hands page bodies `allFiles` including virtual pages (404, tag pages, the tags index,
folder listings), each with a synthetic `relativePath` of `<slug>.md`. bases-page treated them
as notes. https://github.com/quartz-community/bases-page/issues/20

## Expected

`index.md`'s "all other notes" base lists only `Deep` and `Other`; the root-folder base only `Other`.

## Actual

The all-notes base also lists `tags/index`, `tags/demo` and `notes/index`. (The 404 row from the
issue no longer shows with the current Quartz core, which marks its 404 page `unlisted`
(jackyzha0/quartz 631f6b4); the root-folder test guards it anyway.)

## Notes

Root cause: the resolver took every `allFiles` entry with a slug as a note. Virtual pages have no
source `filePath` (Quartz's parser sets it only for real files), so bases-page `dev-mode/this-context`
(9cda99f) skips them in the entry loop and the `asFile()` lookup. Side effect: `.canvas` / Excalidraw
virtual pages are no longer listed either (they were listed with a bogus `<slug>.md` path and `md` ext).
