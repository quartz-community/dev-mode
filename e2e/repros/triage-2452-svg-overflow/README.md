---
title: "SVG image can stretch out of the screen"
issue: "jackyzha0/quartz#2452"
plugins: [obsidian-flavored-markdown]
status: reproduced # open | reproduced | fixed | wontfix
---

# SVG image can stretch out of the screen (jackyzha0/quartz#2452)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

`![[wide.svg]]` → `<object type=image/svg+xml width=auto>` (ofm src/transformer.ts:332). Core base.scss:599 only caps `img { max-width:100% }`, nothing caps `object`. A 3000px SVG renders 3000px wide in an 876px article. Fix: `object[type="image/svg+xml"] { max-width: 100%; height: auto }` (ofm styles or core base.scss), or emit `<img>` for SVG.
