---
title: "Mermaid script crashes when syntax-highlighting is disabled"
issue: null
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# Mermaid script crashes when syntax-highlighting is disabled

## Problem

`obsidian-flavored-markdown/src/scripts/mermaid.inline.ts` measures `pre.querySelector(".clipboard-button")` with `getComputedStyle`, but `.clipboard-button` is rendered by the **syntax-highlighting** plugin (`clipboard.inline.ts`). OFM's manifest doesn't declare that dependency, so any site without syntax-highlighting gets an uncaught TypeError on every page with a mermaid diagram (the e2e bug-repro fixture is one such site).

Fix options: null-guard the clipboard/expand button lookups in mermaid.inline.ts, or declare the dependency in OFM's `quartz.dependencies`.

Found by `just site-smoke fixture:bug-repro` (2026-11-07).

## Steps

1. `just repro-build ofm-mermaid-needs-clipboard` (or `just site-serve repro:ofm-mermaid-needs-clipboard`)
2. Open `/` …

## Expected

<!-- Asserted by repro.spec.ts -->

## Actual

## Notes

Fixed on branch `dev-mode/decoupling` of repos/obsidian-flavored-markdown: the control lookup moved to
`src/scripts/mermaid-controls.ts` (`setupMermaidControls`), which treats `.clipboard-button` as optional and
skips the expand popup (diagram still renders) if OFM's own controls are missing; `.center` falls back to
`document`. Unit test: `test/mermaid-controls.test.ts`. The optional coupling is also declared via
`quartz.capabilities.optional` (dom `.clipboard-button`) in OFM's manifest.
