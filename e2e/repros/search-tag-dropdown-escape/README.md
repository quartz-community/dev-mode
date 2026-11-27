---
title: "Search: Escape in the #tag dropdown closes the whole search"
issue: null
plugins: [search]
status: reproduced # open | reproduced | fixed | wontfix
---

# Search: Escape in the #tag dropdown closes the whole search

## Problem

Open search, type `#ba` (the tag dropdown opens), press Escape: the whole search overlay closes
and the query is lost. The search script means Escape to close only the dropdown.

## Expected / Actual

Expected: the dropdown closes, search stays open with `#ba` in the bar; a second Escape closes
search. Actual: the first Escape closes search (`.search-container` loses `active`, the bar is
emptied).

## Root cause

`search.inline.ts` (search 1.1.4, `onSearchBarKeydown`, line 531 on main): with the dropdown
visible, Escape does `e.preventDefault(); hideTagDropdown(); return;` but does not stop the
event. It bubbles to the document `keydown` listener that `registerEscapeHandler(container,
hideSearch)` (line 630) adds, and that listener (`@quartz-community/utils` `src/dom.ts:24-31`)
calls `onEscape()` for every Escape without checking `e.defaultPrevented`, so `hideSearch()` runs.

Fix options: `e.stopPropagation()` in the dropdown's Escape branch, or skip
`defaultPrevented` events in `registerEscapeHandler` (an infrastructure change: other plugins
use it too).

## Notes

The control test (Escape without the dropdown closes search) passes. Not fixed here.
