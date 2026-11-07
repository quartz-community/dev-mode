---
title: "Mermaid fails with hsl(calc(...)) theme colours"
issue: "jackyzha0/quartz#2595"
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# Mermaid fails with hsl(calc(...)) theme colours (jackyzha0/quartz#2595)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

ofm src/scripts/mermaid.inline.ts:44-66 passes raw `getPropertyValue()` strings to mermaid themeVariables; khroma throws `Unsupported color format`. Spec injects the value from the issue (the theme plugin npm-installs into the sandbox). Fix: resolve vars to rgb via a probe element (`el.style.color = 'var(--x)'; getComputedStyle(el).color`). Part 2 (TB subgraph drawn LR) reproduces with bare mermaid 11.4.0 → upstream. diagramRenderer: pele is unaffected (see triage-2595-pele-theme).
