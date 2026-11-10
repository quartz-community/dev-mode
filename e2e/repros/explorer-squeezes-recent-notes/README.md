---
title: "Explorer squeezes recent notes in the left sidebar"
issue: null
plugins: [explorer, recent-notes]
status: fixed # open | reproduced | fixed | wontfix
---

# Explorer squeezes recent notes in the left sidebar

## Problem

Reported after upgrading to Quartz 5.1 (The World of Luciradis): with an expanded explorer above recent notes in the left sidebar, recent notes got a small scroll area of its own with its last entry cut off, while the explorer kept most of the sidebar.

## Steps

1. `just repro-check explorer-squeezes-recent-notes` (or `just site-serve repro:explorer-squeezes-recent-notes`)
2. Open `/characters/character-10` at 1400×800.

## Expected

The explorer gives up its height first and scrolls; recent notes stays whole while there is room for it. Asserted by repro.spec.ts.

## Actual

Recent notes overflowed its box by 107px; the explorer didn't scroll.

## Notes

Cause: since the #2463 fix (recent-notes `min-height: 0`, so it can shrink in a short sidebar), flex shrinks the explorer and recent notes in proportion to their height. Fixed in explorer: above mobile width `.explorer { flex-shrink: 1000 }`, so it shrinks first; recent notes still shrinks once the explorer is down to its title (triage-2463-recent-notes-scroll).
