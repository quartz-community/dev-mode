---
title: "Inline #tags link to missing tag pages when tag-page is off"
plugins: [obsidian-flavored-markdown, tag-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Inline #tags link to missing tag pages when tag-page is off

Found 2026-11-08 while fixing the same for tag-list and note-properties.

## Notes

obsidian-flavored-markdown turned every inline `#tag` into a link to `tags/<tag>`, which 404s when
the tag-page plugin is disabled. Tags are parsed before pages are emitted, so the fix checks
whether a `TagPage` page type is enabled or a hand-written `tags/<tag>` page exists; otherwise the
tag renders as `<span class="tag-link">`, styled like the link.
