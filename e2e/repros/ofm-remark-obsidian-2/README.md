---
title: "Repro: Obsidian syntax with remark-obsidian 2.x / rehype-obsidian 1.2"
issue: null
plugins: [obsidian-flavored-markdown]
status: fixed   # open | reproduced | fixed | wontfix
---

# Repro: ofm-remark-obsidian-2

## Problem
remark-obsidian 2.x parses callouts into `callout` nodes (rendered as bare `<div>`s by an OFM
that still looked for blockquotes: 175 broken callouts on the docs site), turns every soft line
ending into a `<br>` (`positionedBreaks`) and keeps comments as nodes; `bareFootnoteRefs` needs
rehype-obsidian ≥ 1.1.

## Expected (asserted by repro.spec.ts)
Callouts with Quartz's markup (title, nesting, fold, metadata), soft line endings as `<br>`
(legacy; a space under `strict`), comments hidden, an undefined footnote reference shown as its bare
label, inline footnotes, highlights, tags, wikilinks, tables, math, frontmatter, and callout
syntax inside code left as code.

## Notes
`preset: strict` is checked by building the same content with `preset: strict` (see spec).
