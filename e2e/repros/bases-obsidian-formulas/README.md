---
title: "Bases formulas that render, regular expressions and link columns"
issue: null
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Bases formulas that render, regular expressions and link columns

## Problem

Found comparing bases-page with Obsidian 1.15.1 (`just obsidian-bases-probe`): `html()` showed
its HTML escaped, `icon("star")` showed `:star:`, `image()` showed `!` and a link (a URL became a
broken internal link), regular expressions (`/re/`) evaluated to nothing, `file.links` listed the
note's tags and showed slugs, `file.backlinks` was empty, and `file.properties` held the `title`
and dates Quartz adds.

## Steps

1. `just site-serve repro:bases-obsidian-formulas`
2. Open `/formulas.base`.

## Expected

As in Obsidian: bold text, a star icon, the image, `A.` / `B.`, Alpha links to Beta (not to the
`inline` tag), Beta's backlinks show Alpha, and `file.properties` shows only `status`.
