---
title: "Repro: roam with ObsidianFlavoredMarkdown"
issue: null
plugins: [roam, obsidian-flavored-markdown]
status: fixed
---

# Repro: roam with ObsidianFlavoredMarkdown

With OFM on (default), `{{[[TODO]]}}`, `{{[[DONE]]}}` and `[[>]]` rendered as wikilinks and
`__italic__` as bold: the roam plugin matched its syntax in the parsed tree, after OFM and
CommonMark had read it. Fixed in roam 1.1.0 (rewrites before parsing, `textTransform`;
quartz-community/roam#5), in Quartz's lockfile since jackyzha0/quartz#2626.
