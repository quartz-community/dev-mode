---
title: "Repro: Pele renders Mermaid fences, loaded only where needed"
issue: https://github.com/quartz-community/obsidian-flavored-markdown/pull/14
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# Repro: ofm-pele-diagrams

## Problem

ofm PR #14 adds `diagramRenderer: pele`. As proposed it bundled Pele (~750 KB) into an inline
script, which Quartz serves to every page of every site using ofm, with or without diagrams.
Review comments: reopening the popup stacked toolbars, concurrent `nav`/`render` passes could
mount a diagram twice, the expand button was invisible on keyboard focus.

## Expected (asserted by repro.spec.ts)

- Pages without a Mermaid fence never request Pele.
- Pages with diagrams render them as SVG via the self-hosted plugin asset
  (`static/plugins/obsidian-flavored-markdown/pele/`, Quartz 5.1+), never the CDN, and only fetch
  the chunks of the diagram types on the page.
- Works under a base path, on nested pages and after SPA navigation.
- Opening the popup twice leaves exactly one toolbar; the expand button is visible on focus.

## Notes

Core: plugin assets (`externalResources().assets`, `window.quartzStaticUrl`).
ofm: `pele.inline.ts` imports Pele on demand; jsDelivr fallback on Quartz < 5.1.
