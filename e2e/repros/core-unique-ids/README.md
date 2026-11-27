---
title: "No duplicate element ids on a page with a TOC and backlinks"
issue: ""
plugins: [table-of-contents, backlinks]
status: fixed # open | reproduced | fixed | wontfix
---

# No duplicate element ids

## Notes

The table of contents and the backlinks both rendered their list as `id="list-0"` (each
component numbered its lists on its own). The spec checks every id in the document is unique,
on a direct load and after an SPA navigation, and that the TOC's `button[aria-controls]`
points at the TOC's own list.
