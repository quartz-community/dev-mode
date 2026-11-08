---
title: "Highlights lose formatting and colours"
issue: null
plugins: [obsidian-flavored-markdown, rehype-obsidian]
status: fixed # open | reproduced | fixed | wontfix
---

# Highlights lose formatting and colours

Found 2026-11-08 while checking the 5.1 goals.

## Notes

obsidian-flavored-markdown (transformer.ts, `opts.highlight`) replaces each remark-obsidian
`highlight` node with raw HTML `<span class="text-highlight">` built from the node's _literal_
text: formatted children are dropped (`==**bold** and *italic*==` renders " and "), and
rehype-obsidian's coloured highlights (`==🔴 text==` → `<mark data-highlight="red">`, Obsidian
1.14) never run because there is no `<mark>`. Fix: map the node to `<mark class="text-highlight">`
keeping its children, and style `data-highlight` colours.
