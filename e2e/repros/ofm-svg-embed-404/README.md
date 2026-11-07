---
title: "SVG wikilink embed points at a page-relative path (404)"
issue: "obsidian-flavored-markdown#2 (follow-up)"
plugins: []
status: fixed        # open | reproduced | fixed | wontfix
---

# SVG wikilink embed points at a page-relative path (404)

## Problem
`![[star.svg]]` (file in `content/static/`) renders `<object data="star.svg">` — a page-relative path, so on `features/svg-embed` the browser requests `features/star.svg` → 404. Image embeds (`<img>`) get resolved; `<object data>` apparently does not (check obsidian-flavored-markdown embed handling and crawl-links, which rewrites `src`/`href` but likely not `data`).

The fixture suite's `OFM#2 — SVG wikilinks not resolved` test passes vacuously: it accepts any `article svg`, which matches unrelated icons. Tighten it once fixed.

Found by `just site-smoke fixture:bug-repro` (2026-11-07).

## Steps
1. `just repro-build ofm-svg-embed-404` (or `just site-serve repro:ofm-svg-embed-404`)
2. Open `/` …

## Expected
<!-- Asserted by repro.spec.ts -->

## Actual

## Notes
Root cause: OFM emits raw `<object data="star.svg">` (made an element by rehype-raw); crawl-links resolved
`src` on img/video/audio/iframe but not `object[data]`. Fixed on branch `dev-mode/decoupling` of repos/crawl-links
(`src/transformer.ts`: also resolves `object[data]` and `source[src]`). Unit test: `test/resource-links.test.ts`.
The bug-repro suite's `OFM#2` test now asserts exactly one star.svg embed whose reference returns 200.
