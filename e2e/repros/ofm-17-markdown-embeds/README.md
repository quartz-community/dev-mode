---
title: "Markdown-link embeds (![](note.md)) render as broken images"
issue: "quartz-community/obsidian-flavored-markdown#17"
plugins: [obsidian-flavored-markdown, canvas-page, bases-page]
status: fixed # quartz-community/obsidian-flavored-markdown#43 merged 2026-11-26 (not yet on npm)
---

# Markdown-link embeds (`![](note.md)`) render as broken images

## Problem

Obsidian embeds any internal link with `!` in front, and writes embeds as Markdown images when
"Use [[Wikilinks]]" is off. OFM transcluded only `![[note]]`; `![](note.md)` stayed an `<img>`.

## Expected (probed in Obsidian 1.15.1 with `just obsidian-bases-probe`)

Obsidian transcludes `![](other.md)`, `![](other)` (no extension: a note), `![](OTHER.MD)`,
`![](Other%20Note.md#Section)`, `![alt](other.md#^blk)`, `![](<Other Note.md>)`,
`![](board.canvas)`, `![Projects](projects.base)`, and from `sub/`: `![](../other.md)`,
`![](deep.md)` (by name), `![](/other.md)` (vault root) — the same lookup as for wikilinks
(`getFirstLinkpathDest`), whatever the "New link format" setting. `![](missing.md)` is an empty
note embed ("not created yet").

## Notes

Fix: OFM branch `dev-mode/markdown-embeds`, option `markdownEmbeds` (default on): image nodes
pointing at `.md`/`.canvas`/`.base`, or extensionless at an existing page, become the same
transclusion as `![[…]]`. The inner link is resolved by Quartz's links built-in like any Markdown
link (`markdownLinkResolution`). A `.base` path with folders is resolved against the note's folder
(or the root) first, since bases-page looks bases up by vault path or name.
