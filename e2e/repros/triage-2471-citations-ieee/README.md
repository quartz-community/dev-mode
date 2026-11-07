---
title: "Numeric citation style has wrong newlines"
issue: "jackyzha0/quartz#2471"
plugins: [citations]
status: reproduced # open | reproduced | fixed | wontfix
---

# Numeric citation style has wrong newlines (jackyzha0/quartz#2471)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

IEEE CSL emits `div.csl-left-margin` + `div.csl-right-inline`; no CSS anywhere in citations/core, so they stack (label 20px above text). Fix (citations plugin CSS): `.csl-entry{display:flex;gap:.5em}` or `.csl-left-margin{float:left;min-width:2.5em}`. Note: bibliographyFile is resolved against cwd (sandbox), hence the ../../../ path.
