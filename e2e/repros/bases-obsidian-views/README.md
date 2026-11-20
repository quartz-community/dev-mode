---
title: "Bases views and grouping: kanban, groupOrder, None, list options, rowHeight"
issue: null
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Bases views and grouping: kanban, groupOrder, None, list options, rowHeight

## Problem

Found comparing bases-page with Obsidian 1.15.1 (`just obsidian-bases-probe`): `type: kanban`
(Obsidian 1.14+) was an unknown view type, `groupOrder` was ignored, the group without a value was
"Uncategorized" and came first, list and cards views ignored `groupBy`, the list options
`markers`, `separator` and `indentProperties` were ignored, and so was a table's `rowHeight`.

## Steps

1. `just site-serve repro:bases-obsidian-views`
2. Open `/views.base` and look at each view.

## Expected

As in Obsidian: kanban columns None, A, B (300px wide); the "Group order" table shows only A and
None; the list is numbered with `|` between properties; the grouped list has headings A, B,
None; tall rows are 120px.
