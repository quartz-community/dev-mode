---
status: reproduced # quartz-community/folder-page#23 (unmerged); set to fixed once released and in Quartz
issue: "quartz-community/folder-page#23"
plugin: folder-page
---

# An unlisted index note is replaced by a generated folder page

A folder whose own `index.md` is unlisted (`unlisted: true`) still got a generated folder page.
It has the same slug (`notes/index`), so it replaced the note: the note's own title and text never
appeared on the site. folder-page skipped unlisted pages when collecting folders that already
have an index note (`src/pageType.ts`).

Expected: `/notes/` shows the hand-written note (with the folder listing below it), and the note
stays out of listings.
