---
title: "Broken links in canvas"
issue: "jackyzha0/quartz#2569"
plugins: [canvas-page]
status: reproduced # open | reproduced | fixed | wontfix
---

# Broken links in canvas (jackyzha0/quartz#2569)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

Text nodes rendered with bare micromark+gfm (canvas-page src/pageType.ts:15-31): `[Note](Note.md)` keeps `href=Note.md` (404) and `[[Note]]` is not a link. File nodes are fine. Fix: run text nodes through the site's markdown pipeline (or at least resolve .md hrefs/wikilinks against allSlugs).
