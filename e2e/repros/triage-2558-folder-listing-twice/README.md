---
title: "Folder/tag virtual pages render their listing twice"
issue: "jackyzha0/quartz#2558"
plugins: [folder-page, tag-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Folder/tag virtual pages render their listing twice (jackyzha0/quartz#2558)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

Exactly one `.page-listing` on folder and tag pages, direct load and after SPA navigation, on quartz dev-mode/improvements.
