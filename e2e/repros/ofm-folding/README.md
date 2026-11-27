---
title: "Folding headings, list items (foldHeadings, foldLists) and callouts"
issue: ""
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# Folding headings and list items

## Notes

With `foldHeadings: true` and `foldLists: true` obsidian-flavored-markdown adds Obsidian's
fold arrows (`.heading-collapse-indicator`, `.list-collapse-indicator`); its browser script
(`src/scripts/fold.inline.ts`, one delegated click listener for the page's lifetime) toggles
`is-collapsed` on the heading's block (`div.el-h2`) or the `li`, and marks every top-level
block under a folded heading, up to the next heading of the same or a higher level, with
`data-fold-hidden`.

The spec clicks the arrows and checks exactly which blocks are hidden (and that a heading
folded inside a folded section stays folded when the outer one opens), that list items hide
their sublist only, and that all of it still works after an SPA navigation away and back
(a second listener would toggle twice and fold nothing).

`other.md` has a folded callout (`> [!faq]- Q`): a click on its title toggles `is-collapsed` on
the callout and its `.callout-fold` and switches the content between `0fr` and `1fr`
(`src/scripts/callout.inline.ts`), also after SPA navigations.
