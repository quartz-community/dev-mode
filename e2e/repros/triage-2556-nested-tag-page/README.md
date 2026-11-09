---
title: "Parent tag page collides with child tag directory"
issue: "jackyzha0/quartz#2556"
plugins: [tag-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Parent tag page collides with child tag directory (jackyzha0/quartz#2556)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

tag-page src/pageType.ts:51 uses slug `tags/<tag>` → `tags/kubernetes.html` next to `tags/kubernetes/` (k3s.html, kubectl.html). Static hosts resolve the directory → 404. Local static server falls back to .html, so the spec checks output layout. Fix: emit `tags/<tag>/index` (like folder pages) at least when a tag has children, and link to `tags/<tag>/`.
