---
title: "Search: #tag mode and keyboard navigation of the results"
issue: null
plugins: [search]
status: fixed # open | reproduced | fixed | wontfix
---

# Search: #tag mode and keyboard navigation

Browser coverage for parts of `search.inline.ts` no other test ran: the `#tag` search mode and
the full keyboard navigation of results (search-enter-navigation covers ArrowDown + Enter).

Tags: Bread [cooking, baking], Cake [baking], Soup [cooking], Hiking [outdoors].

## Expected (asserted by repro.spec.ts)

- Typing `#` opens `.tag-suggestions` with every tag (sorted, first one active); more letters
  narrow it (`#co` → `#cooking`, the rest shown as `.ghost-text`); no match hides it.
- ArrowDown / ArrowUp move the active suggestion (clamped at both ends); Enter or Tab accept it
  (`#cooking ` in the bar, dropdown hidden) without opening a result, and the results are the
  pages with that tag.
- `#tag words` matches pages with the tag _and_ the words; `#a #b` needs both tags; no match
  shows the "No results" card.
- Ctrl+Shift+K opens search with `#` in the bar and the tag dropdown open.
- Results: ArrowUp / ArrowDown / Tab / Shift+Tab move the focused card (clamped at both ends,
  focus stays in the bar, one `.focus` card, the preview shows it); Enter opens the focused
  card through the SPA router (no page load) and closes search.

## Notes

Passes with the released search 1.1.4. Escape with the dropdown open closes the whole search
instead of only the dropdown: a bug, in its own repro `search-tag-dropdown-escape`.
