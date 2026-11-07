---
title: "recent-notes list cut off in a short window (#2463)"
issue: "jackyzha0/quartz#2463"
plugins: [recent-notes]
status: fixed # open | reproduced | fixed | wontfix
---

# recent-notes list cut off in a short window (#2463)

## Problem

Left sidebar is sticky with height: 100vh and no overflow; recent-notes has no scroll container, so with a short window the list (and anything after it) is unreachable.

## Steps

1. `just repro-check triage-2463-recent-notes-scroll` (strict) or `just site-serve repro:triage-2463-recent-notes-scroll`

## Expected

Asserted by repro.spec.ts.

## Actual

At 1280x500 the 10th recent note is clipped below the sidebar; page scrolling only moves the centre column.

## Notes

Cause: repos/quartz/quartz/styles/base.scss:221-229 (.sidebar sticky, height 100vh) + repos/recent-notes/src/components/styles/*.scss (no flex-shrink/overflow-y). Fix idea: give .recent-notes `min-height: 0; overflow-y: auto; flex: 0 1 auto` (like explorer's OverflowList) or let the left sidebar scroll (overflow-y: auto).
