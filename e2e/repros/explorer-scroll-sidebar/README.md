---
title: "Explorer scroll position with a scrolling sidebar"
issue: quartz-community/explorer#14
plugins: [explorer]
status: fixed # quartz-community/explorer#37 merged 2026-11-26 (not yet on npm)
---

# Explorer scroll position with a scrolling sidebar

With `layout.sidebars.left: scroll` the sidebar scrolls, not `.explorer-ul`: SPA navigation reset it to the top (the explorer saved/restored `.explorer-ul.scrollTop`, always 0), and opening a page directly scrolled the page. Expected: the sidebar's position is kept; no fade on the (unclipped) list.

Run: `just repro-check explorer-scroll-sidebar`. Fixed on explorer branch `dev-mode/scroll-fixes`.
