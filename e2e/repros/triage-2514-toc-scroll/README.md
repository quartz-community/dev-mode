---
title: "Long TOC not fully scrollable (#2514)"
issue: "jackyzha0/quartz#2514"
plugins: [table-of-contents]
status: reproduced # open | reproduced | fixed | wontfix
---

# Long TOC not fully scrollable (#2514)

## Problem

With many headings, scrolling the TOC list to its end still leaves the last entries below the viewport.

## Steps

1. `just repro-check triage-2514-toc-scroll` (strict) or `just site-serve repro:triage-2514-toc-scroll`

## Expected

Asserted by repro.spec.ts.

## Actual

At 1280x800 the scrolled-to-end ul.toc-content ends at y≈1065 (viewport 800); headings 51-60 of 60 are unreachable.

## Notes

Cause: repos/table-of-contents/src/components/styles/toc.scss:6 (.toc flex: 0 0.5 auto) and :44 (max-height: calc(100% - 2rem)) let .toc grow past the 100vh sticky right sidebar (graph above it). Fix idea: .toc { flex: 0 1 auto; min-height: 0 } and make the ul flex: 1; min-height: 0 instead of a %-based max-height.
