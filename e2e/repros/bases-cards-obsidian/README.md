---
title: "Repro: bases cards render like Obsidian's"
issue: quartz-community/bases-page#10
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Repro: bases cards render like Obsidian's (bases-page#3, #10)

## Problem

Each card was an `<a>` containing property links: invalid nested anchors, which the HTML parser
split into two grid items per card (#10). `imageAspectRatio` was applied as width/height, the
inverse of Obsidian's height/width (#3).

## Expected (Obsidian 1.15.0, obsidian-bases-probe vault q3-cards)

- a card is a box with one stretched file-name link; property links are their own links
- cover height = card width × imageAspectRatio; a view with `image:` gives cards without an image
  an empty cover; `order: []` shows only the cover

## Notes

Content is the probe vault `q3-cards`; `cards.md` embeds the views. Fixed in bases-page
(cards.tsx rewrite).
