---
title: "Repro: footnote referenced only in a surplus table cell disappears"
issue: null
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# Repro: ofm-table-surplus-cell-footnote

## Problem

A footnote whose only reference sits in a table cell past the delimiter row's column count
disappeared from the page, definition and all. `mdast-util-to-hast` (like GFM) renders only the
declared columns, so the reference was never reached and the definition never rendered.
Obsidian hides the cell too but renders the footnote.

## Steps

1. `just site-serve repro:ofm-table-surplus-cell-footnote`
2. Open `/`

## Expected

- Surplus cells stay hidden (GFM, Obsidian).
- Footnotes referenced in hidden cells (`[^x]` and inline `^[...]`) render, numbered at that
  reference in source order: Obsidian 1.15.0, remark-obsidian parity goldens
  `triage/nightly2/np-S1`, `np-S3`, `np-S4`, `np-S5` (`test/parity/goldens/projection-triage.json`).
- No back-link points at a reference the page does not show (Obsidian emits one that leads
  nowhere; we omit it). A footnote also cited in the text links back to that citation only.

## Actual (before)

`[^only]` and the inline note were missing; `[^both]` was numbered 1.

## Notes

Fixed in obsidian-flavored-markdown (`src/util/surplus-footnotes.ts`): an mdast pass copies
references in surplus cells into a hidden span in the row's last rendered cell, so
mdast-util-to-hast numbers them and renders their definitions; a rehype pass after
rehype-obsidian (whose renumbering must count them) removes the span and the back-links to it.
