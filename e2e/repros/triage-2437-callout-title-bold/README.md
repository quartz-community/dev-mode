---
title: "Callout has part of the body inserted into title"
issue: "jackyzha0/quartz#2437"
plugins: [obsidian-flavored-markdown, remark-obsidian]
status: fixed # open | reproduced | fixed | wontfix
---

# Callout has part of the body inserted into title (jackyzha0/quartz#2437)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

Reporter's markdown (nested callout, trailing double space after title) and commenter's nested callouts with **bold** in body/title render correct titles on ofm dev-mode/pele (remark-obsidian 2.1 parses callouts). Title text keeps the trailing spaces (`<p>Dosage  </p>`), harmless.
