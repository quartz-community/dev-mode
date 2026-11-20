---
title: "Custom Bases summaries render only their name"
issue: "Discord report (custom summaries in Bases), 2026-11-20"
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Custom Bases summaries render only their name

## Problem

A custom summary (Obsidian: **Add summary**, stored under the base's top-level `summaries:`) shows
only its name in Quartz. For `total pages: values.reduce(acc + value, 0)` the footer cell reads
"total pages" where Obsidian shows the total. Built-in summaries also differ from Obsidian: no label,
`Average` ignores empty values, numbers aren't rounded to 2 decimals, `Earliest`, `Latest` and a date
`Range` print their name, and a grouped table has no per-group summaries.

## Steps

1. `just site-serve repro:bases-custom-summaries`
2. Open `/books.base` and look at each view's footer (and `/`, which embeds the base).

## Expected

What Obsidian 1.15.1 shows for `content/Books.base`, recorded with
`just obsidian-bases-probe e2e/repros/bases-custom-summaries/content`:

| View              | Footer in Obsidian                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Reporter          | total pages **Empty** (`values` includes the draft's empty `pages`; `acc + null` is null) · Filled 6 · Empty 0                              |
| Builtins A        | Sum 415 · Average **3.08** (empty values count: 18.5 / 6) · Checked 3 · Earliest 2023-11-20T00:00:00 · Unique 3                             |
| Builtins B        | Median 80 · Stddev 0.87 (population) · Unchecked 2 · Latest 2025-01-15T00:00:00 · Filled 6                                                  |
| Builtins C        | Min 64 · Max 5 · Range **a year** (dates) · Empty 0                                                                                         |
| Builtins D        | Range 47 · Median 4 · Unique 3                                                                                                              |
| Custom            | long books 3 · mean rounded 3.1 · how many values 6 · as list "Orwell, Swift, …" · broken `Error: Cannot find function "nope" on type List` |
| Custom index      | first plus rest Empty                                                                                                                       |
| Grouped           | one row per group (Doyle Empty, Orwell 144, Swift 160), then the whole table (Empty)                                                        |
| Cards             | no summaries                                                                                                                                |
| Known pages       | total pages 415 · first plus rest 414.5 · undefined name **Empty** · unique **Empty** (names are case-sensitive)                            |
| Known pages index | first plus rest 8335 (`index` is 0-based) · Average 3.7                                                                                     |

## Actual

Every custom summary prints its name; cells have no label; `Average` 3.7, `Stddev`
0.8717797887081347; `Earliest` / `Latest` / date `Range` print their name; unknown names print
themselves; a grouped table has only the overall footer.

## Notes

`computeSummary` (`repos/bases-page/src/components/shared/summary.tsx`) knows only the built-in names
and returns the name for anything else; the top-level `summaries:` (declared in `types.ts`) is never
read. The formula compiler has no `values` identifier and no list `reduce` (`acc`, `index`); lazy
list methods bind only `value`.
