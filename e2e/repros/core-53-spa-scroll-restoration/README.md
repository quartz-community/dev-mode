---
title: "SPA scroll restoration on Back, Forward and reload"
issue: "jackyzha0/quartz#2674"
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# SPA scroll restoration on Back, Forward and reload (jackyzha0/quartz#2674)

## Notes

In 5.3 the SPA router (core `components/scripts/spa.inline.ts`) restores positions itself:
`history.scrollRestoration = "manual"`, each entry keeps its `scrollY` in `history.state`
(saved 150 ms after the last scroll event, before a navigation, and on `pagehide`), and a
position still waiting to be saved when Back or Forward leaves the entry is kept by entry key.
Before, the browser restored the position while the other page's content was still shown.

The spec covers Back and Forward between pages, a position left within the 150 ms save delay,
Back after a same-page heading link (no fetch, no reload) and a reload.
