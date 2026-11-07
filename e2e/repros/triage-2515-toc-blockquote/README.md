---
title: "Titles in blockquotes shouldn't be in the TOC"
issue: "jackyzha0/quartz#2515"
plugins: [table-of-contents]
status: reproduced # open | reproduced | fixed | wontfix
---

# Titles in blockquotes shouldn't be in the TOC (jackyzha0/quartz#2515)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

table-of-contents src/transformer.ts:45 visits every mdast `heading`, including ones inside `blockquote` (and callouts, which are blockquotes). Fix: skip headings with a blockquote ancestor (visitParents / `SKIP` on blockquote).
