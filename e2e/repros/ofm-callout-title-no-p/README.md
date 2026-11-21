---
title: "callout titles without a <p>, as in Obsidian"
issue: null
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# callout titles without a <p>, as in Obsidian

## Notes

obsidian-flavored-markdown rendered a callout title as `.callout-title-inner > p`; Obsidian puts the title text in `.callout-title-inner` itself. With @quartz-themes/core 3.0 the `<p>` is reset to browser styles and themes give it paragraph margins, so the title sat a line below its icon (AnuPpuccin, Blue Topaz: title box 53px next to a 21px icon). Fixed in obsidian-flavored-markdown (no `<p>`) and Quartz `callouts.scss` (colour, margin and the paragraph line height on `.callout-title-inner`, so Quartz's own look is unchanged).
