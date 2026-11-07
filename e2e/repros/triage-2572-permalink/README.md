---
title: "permalink does not provide a path-independent URL"
issue: "jackyzha0/quartz#2572"
plugins: [alias-redirects]
status: reproduced # open | reproduced | fixed | wontfix
---

# permalink does not provide a path-independent URL (jackyzha0/quartz#2572)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

Core frontmatter.ts:108-111 only adds permalink to aliases; alias-redirects writes a meta-refresh at the permalink to the path slug. Sitemap/RSS/contentIndex use the path slug. Either set the slug from permalink or fix the docs (authoring-content.md:34).
