---
title: "permalink equal to own path → infinite redirect"
issue: "jackyzha0/quartz#2590"
plugins: [alias-redirects]
status: fixed # open | reproduced | fixed | wontfix
---

# permalink equal to own path → infinite redirect (jackyzha0/quartz#2590)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

alias-redirects src/emitter.ts:150-163 writes a redirect for every alias without checking it equals the page's own slug; `permalink: /test-page` (and `other`) overwrite test-page.html/other.html with a self-redirect. Fix: skip aliases whose stripped slug equals the page slug (and any existing content slug).
