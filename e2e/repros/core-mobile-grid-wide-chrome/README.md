---
title: "Phone layout: wide header chrome widens the page"
issue: null
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# Phone layout: wide header chrome widens the page

## Problem

On phones Quartz's page is one grid column (`grid-template-columns: auto`). An auto track grows to
the min-content of its widest item, so one item in the header row that can't shrink (a long
page title without break opportunities, or a theme's styled header) made the whole page column
wider than the screen: the content column was 856px wide on a 375px screen here, and every page
scrolled sideways. Found in a registry-wide @quartz-themes/core layout audit (Dedication: 555px).

## Steps

1. `just site-serve repro:core-mobile-grid-wide-chrome`
2. Open `/` at 375px wide.

## Expected

The page column, the page title and the document stay within the screen (asserted by repro.spec.ts).

## Actual (before the fix)

The content column is 856px wide; the page scrolls sideways.

## Fix

Quartz core: the phone and tablet content columns (and the full-width and minimal frames) are
`minmax(0, 1fr)`, and text in the phone header row may break anywhere.
