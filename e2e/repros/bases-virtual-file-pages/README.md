---
title: "Canvas and Excalidraw files are missing from base views (no source file path)"
issue: null
plugins: [bases-page, canvas-page, obsidian-plugin-excalidraw]
status: fixed # open | reproduced | fixed | wontfix
---

# Canvas and Excalidraw files in base views

## Problem

canvas-page and obsidian-plugin-excalidraw render `.canvas`, `.excalidraw` and `.excalidraw.md`
files as virtual pages, but gave them no `filePath`, so Quartz core filled in a synthetic
`relativePath` of `<slug>.md`. bases-page listed them with a wrong path and `md` extension; since
bases-page `dev-mode/this-context` (9cda99f, bases-page#20) skips pages without a `filePath`, they
were not listed at all. Obsidian Bases lists every file in the vault.

## Steps

1. `just site-serve repro:bases-virtual-file-pages`
2. Open `/`: the first base lists everything in `boards/`, the second only `file.ext == "canvas"`.

## Expected

| file.name         | file.path                   | file.ext   | file.folder |
| ----------------- | --------------------------- | ---------- | ----------- |
| Diagram           | boards/Diagram.excalidraw   | excalidraw | boards      |
| Note              | boards/Note.md              | md         | boards      |
| Plan              | boards/Plan.canvas          | canvas     | boards      |
| Sketch.excalidraw | boards/Sketch.excalidraw.md | md         | boards      |

(`file.name` follows bases-page's convention for notes, the name without extension; Obsidian's
`file.name` includes it.) The rows link to the rendered pages.

## Actual

Only `Note` is listed (before bases-page#20: the drawings with `<slug>.md` paths and `md` ext).

## Notes

Fix: canvas-page and obsidian-plugin-excalidraw (branches `dev-mode/virtual-page-filepath`) set
`filePath` (`<content dir>/<file>`) and `relativePath` (`<file>`) on their virtual pages, as
Quartz's parser does for notes. bases-page needs no code change; it now documents and tests that
file-backed virtual pages are listed.

obsidian-plugin-excalidraw is not a Quartz dependency, so it is not in `repos/quartz/node_modules`;
`quartz.config.yaml` loads the workspace clone as a local plugin (path relative to the sandbox).
