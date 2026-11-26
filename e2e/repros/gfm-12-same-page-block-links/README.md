---
title: "Same-page block links (#^id) are not resolved"
issue: "quartz-community/github-flavored-markdown#12"
plugins: [github-flavored-markdown, obsidian-flavored-markdown, rehype-obsidian]
status: reproduced # set to fixed once the fix branch is in the workspace (passes with it)
---

# Same-page block links (`#^id`) are not resolved

## Problem

github-flavored-markdown (order 30) resolves same-page `#` links against the ids on the page,
but block ids (`^real` → `id="real"`) are given later, by obsidian-flavored-markdown (order 40,
rehype-obsidian's `blockReferences`). `[x](#^real)` and `[[#^real]]` stay `#%5Ereal`. Quartz
core's built-in links (order 60) don't resolve same-page anchors (crawl-links did).

## Expected

Both links get `href="#real"`, as Obsidian follows them.

## Notes

Fix: rehype-obsidian `blockReferences` points same-page `#^id` links at the block it just gave
the id to (branch `dev-mode/same-page-block-links`). OFM bundles rehype-obsidian, so OFM needs
a rebuild/release after it.
