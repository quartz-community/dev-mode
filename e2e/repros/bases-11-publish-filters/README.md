---
title: "Bases, canvases and drawings ignore publish filters and encryption"
issue: "quartz-community/bases-page#11"
plugins:
  [
    bases-page,
    canvas-page,
    obsidian-plugin-excalidraw,
    explicit-publish,
    encrypted-pages,
  ]
status: fixed # open | reproduced | fixed | wontfix
---

# Bases, canvases and drawings ignore publish filters and encryption (quartz-community/bases-page#11)

## Problem

With `explicit-publish`, every `.base`, `.canvas` and Excalidraw file got a page, listed in the
content index, folder pages and explorer, although nothing opted it in; and with `encrypted-pages`
those pages were served in the clear. Page types build their pages from `ctx.allFiles` during
emit, after the filter stage, and encryption runs in `htmlPlugins`, which these pages never pass.

## Steps

1. `just site-build repro:bases-11-publish-filters`
2. Open `/secret.canvas`, `/secret.base`, `/drafts/private.base`, `/boards/hidden.excalidraw`.

## Expected (repro.spec.ts)

- `Secret.base`/`Secret.canvas` (referenced by nothing), `drafts/Private.*` (referenced only by an
  unpublished note) and `boards/Hidden.excalidraw.md` (frontmatter without `publish: true`) have no
  page and are not listed (content index, `boards/` folder page).
- `Linked.canvas` (linked from the published index) and `boards/Drawing.excalidraw.md`
  (`publish: true`) are published.
- `Shared.base`, only embedded in the index, renders there but has no page of its own.
- `Locked.canvas`, linked from the encrypted note `locked`, is encrypted with its password.

## Actual (before the fix)

All of them were published, `Locked.canvas` unencrypted.

## Notes

Fix (branches `dev-mode/virtual-page-filters` in quartz, `dev-mode/publish-filters` elsewhere):

- quartz: the dispatcher runs the site's filters on the pages of page types with `fileExtensions`,
  with `file.data.referencedBy` (published pages linking to them); rejected pages are dropped.
  New transformer hook `virtualPageHtmlPlugins(ctx, content)` runs on their rendered body.
- explicit-publish: a non-Markdown page is published when `referencedBy` is non-empty.
- encrypted-pages: encrypts these pages (own `password`, or inherited from the encrypted note
  linking to a file without frontmatter). unlisted-pages: `unlisted:` on `.excalidraw.md`.
- obsidian-plugin-excalidraw: its filter keeps its own pages and hands a Markdown drawing's
  frontmatter to the page. bases-page: `.base` pages carry the file's paths.

`private/` is in Quartz's default `ignorePatterns`, hence `drafts/` for the unpublished note.
