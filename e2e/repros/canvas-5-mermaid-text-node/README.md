---
title: "Mermaid diagrams in canvas text nodes"
issue: "quartz-community/canvas-page#5"
plugins: [canvas-page, obsidian-flavored-markdown]
status: fixed # quartz-community/canvas-page#17 merged 2026-11-26 (canvas-page 1.1.4 on npm)
---

# Mermaid diagrams in canvas text nodes (quartz-community/canvas-page#5)

## Problem

A ` ```mermaid ` fence in a canvas text node stayed a code block: text nodes were rendered with
bare micromark + GFM (canvas-page `pageType.ts`), not the site's Markdown pipeline, so ofm never turned
it into `div.mermaid` for Pele (Quartz 5.3's default `diagramRenderer`).

## Expected

Diagram rendered as SVG (direct load and after SPA navigation); callouts, wikilinks, KaTeX and code
highlighting work in text nodes too (as in Obsidian, where text nodes are full notes).

## Notes

Fix (canvas-page branch `dev-mode/site-markdown-text-nodes`): `generate` (async, Quartz 5.1+) builds
one unified processor from `ctx.cfg.plugins.transformers` (textTransform → remark-parse →
markdownPlugins → remark-rehype → htmlPlugins), and renders each text node with a VFile standing for
the canvas file (slug/filePath/relativePath). ofm's always-loaded Pele loader finds `div.mermaid`
under the canvas frame's `.center`. Option `textNodeMarkdown: basic` = old rendering; a plugin error
falls back to it. Limitations: `![[embeds]]` in text nodes aren't filled in (transclusion runs on the
page tree), `#tags` in text nodes link to tag pages that may not exist (tags aren't indexed);
created-modified-date runs once per text node.
