---
title: "Collapsed Explorer title clipped with community themes (#2532)"
issue: "jackyzha0/quartz#2532"
plugins: [explorer, quartz-themes-core]
status: reproduced # open | reproduced | fixed | wontfix
---

# Collapsed Explorer title clipped with community themes (#2532)

## Problem

Collapsed .explorer is flex: 0 1 1.2rem with overflow-y: hidden; themes enlarge the h2 so its bottom is cut off. Tested with catppuccin (Aura is not installed in the workspace and loading it would npm-install).

## Steps

1. `just repro-check triage-2532-explorer-collapsed-theme` (strict) or `just site-serve repro:triage-2532-explorer-collapsed-theme`

## Expected

Asserted by repro.spec.ts.

## Actual

catppuccin: h2 is 31.6px tall (21px font, 31.6px line-height), collapsed .explorer is 19.2px.

## Notes

Cause: repos/explorer/src/components/styles/explorer.scss:28-30 (.explorer.collapsed { flex: 0 1 1.2rem }) and :83-87 (h2 sets font-size but not line-height). Fix idea: collapsed flex-basis auto / min-height: fit-content, or pin line-height on the button h2.
