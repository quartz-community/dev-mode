---
title: "Inconsistent path resolution for SVG image"
issue: "jackyzha0/quartz#2521"
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# Inconsistent path resolution for SVG image (jackyzha0/quartz#2521)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

`![[banner.svg]]` with the file in `sub/deep/` resolves to `./sub/deep/banner.svg` (root page) and `../sub/deep/banner.svg` (nested page), both 200. Same root cause as ofm-svg-embed-404 (object[data] resolution), fixed on dev-mode branches.
