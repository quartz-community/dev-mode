---
title: "TOC highlight out of sync after fast scroll (#2482)"
issue: "jackyzha0/quartz#2482"
plugins: [table-of-contents]
status: fixed # open | reproduced | fixed | wontfix
---

# TOC highlight out of sync after fast scroll (#2482)

## Problem

TOC highlighting is IntersectionObserver-only; a heading that jumps from below to above the viewport in one frame never fires a callback.

## Steps

1. `just repro-check triage-2482-toc-fast-scroll` (strict) or `just site-serve repro:triage-2482-toc-fast-scroll`

## Expected

Asserted by repro.spec.ts.

## Actual

Instant scrollTo bottom leaves ~19 passed headings without .in-view; instant jump back to top leaves them highlighted. With smooth scrolling (base.scss scroll-behavior: smooth) the bug does not show.

## Notes

Cause: repos/table-of-contents/src/components/scripts/toc.inline.ts:1-14. Fix idea: in the callback (or a rAF-throttled scroll listener) recompute all headings' in-view state from getBoundingClientRect, not only the entries passed.
