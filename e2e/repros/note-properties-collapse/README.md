---
title: "note-properties: a collapsed properties view stays collapsed"
issue: ""
plugins: [note-properties]
status: fixed # open | reproduced | fixed | wontfix
---

# note-properties collapse state

## Notes

note-properties 1.2.3 renders the properties as `details.note-properties`; its script mirrors
`open` as Obsidian's `is-collapsed` class and keeps the reader's choice in `localStorage`, so a
view collapsed on one page is collapsed after a reload and on the next note (SPA navigation),
and opened again it loses `is-collapsed` and stays open after a reload.
