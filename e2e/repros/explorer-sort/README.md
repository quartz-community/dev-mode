---
title: "Explorer sort rules from YAML"
issue: quartz-community/explorer#6
plugins: [explorer]
status: fixed # quartz-community/explorer#38 (explorer 1.2.0)
---

# Explorer sort rules from YAML

`sort: [folder, { by: date, direction: desc }, title]`. Quartz core writes page dates to contentIndex.json, with `dateFromFrontmatter` for frontmatter dates (jackyzha0/quartz#2703, #2709): the newest page comes first, and a folder sorts by its index page's frontmatter date, else by its newest page. The spec simulates older cores by rewriting the index: without dates the title decides; with dates but no `dateFromFrontmatter`, folders sort by their newest page.

Run: `just repro-check explorer-sort`. Fixed on explorer branch `dev-mode/sort-option`.
