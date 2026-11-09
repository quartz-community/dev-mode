---
title: "permalink does not provide a path-independent URL"
issue: "jackyzha0/quartz#2572"
plugins: [alias-redirects]
status: fixed # open | reproduced | fixed | wontfix
---

# permalink does not provide a path-independent URL (jackyzha0/quartz#2572)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

Core frontmatter.ts:108-111 only adds permalink to aliases; alias-redirects writes a meta-refresh at the permalink to the path slug. Sitemap/RSS/contentIndex use the path slug. Either set the slug from permalink or fix the docs (authoring-content.md:34).

## Resolution

Permalinks follow Obsidian Publish: `permalink` is the page's address (links, sitemap, RSS and
the content index use it), and the note's file path plus its `aliases` redirect to it. Core
reads permalinks before parsing (`quartz/util/permalinks.ts`); the links built-in resolves links
by file path and points them at the permalink.
