---
title: "Explorer sort rules from YAML"
issue: quartz-community/explorer#6
plugins: [explorer]
status: reproduced # fixed on an unmerged explorer branch (quartz-community/explorer#36–#39); set to fixed once released
---

# Explorer sort rules from YAML

`sort: [folder, { by: date, direction: desc }, title]`. Without dates in contentIndex.json (Quartz core today) the title decides; with dates (injected by the spec, as the pending core change will write them) the newest page comes first; folders sort by their newest page, or by their index page's frontmatter date when the index entry has `dateFromFrontmatter` (jackyzha0/quartz#2703).

Run: `just repro-check explorer-sort`. Fixed on explorer branch `dev-mode/sort-option`.
