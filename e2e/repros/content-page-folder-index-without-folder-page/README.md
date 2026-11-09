---
title: "Folder index.md is dropped when folder-page is off"
plugins: [content-page, folder-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Folder index.md is dropped when folder-page is off

Found 2026-11-08 next to the same bug for `tags/` pages (repro `ofm-inline-tag-without-page`).

## Notes

content-page's matcher skipped every `…/index` slug and left it to folder-page, so with folder-page
disabled a hand-written `folder/index.md` was never emitted. Fix: content-page matches every page;
folder-page (priority 10) still claims `…/index` first when it's enabled.
