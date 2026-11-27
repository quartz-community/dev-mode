---
title: "Search: ArrowDown + Enter opens the result through the SPA router"
issue: ""
plugins: [search]
status: fixed # open | reproduced | fixed | wontfix
---

# Search keyboard navigation

## Notes

Typing `zebra` finds two pages; the first is focused, ArrowDown focuses the second and Enter
clicks it (`search.inline.ts` `onSearchBarKeydown`). The page opens through the SPA router
(a `window.__marker` set before survives), the URL is the result's
and the overlay is closed.
Spec shared with `search-enter-navigation-base` (site under `/sub`).
