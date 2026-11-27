---
title: "Leaflet: ```leaflet blocks are not rendered (the plugin is still the template)"
issue: null
plugins: [obsidian-plugin-leaflet]
status: reproduced # open | reproduced | fixed | wontfix
---

# Leaflet: ```leaflet blocks are not rendered

## Problem

`@quartz-community/obsidian-plugin-leaflet` (npm 1.0.1, origin/main `bce98f2`) does not render
Obsidian Leaflet maps: a ` ```leaflet ` block stays a syntax-highlighted code block.

## Expected / Actual

Expected (asserted by repro.spec.ts, with Leaflet's standard DOM): the block becomes one
`.leaflet-container` (300px high, with `.leaflet-tile-pane`) with one `.leaflet-marker-icon` per
`marker:` line, without page errors, also after SPA navigation Amsterdam → Utrecht → Amsterdam.
Actual: `<pre data-language="leaflet">` with the block's text; no map.

## Root cause

The repository is the unmodified plugin template: `package.json` → `quartz.name` is
`"plugin-template"`, the description is "Template repository for Quartz community plugins.",
and `src/` only has `ExampleTransformer` (`==` → bold, heading classes), `ExampleFilter`,
`ExampleEmitter` and `ExampleComponent`. Nothing in it handles `leaflet` code blocks or loads
Leaflet. Enabling it also applies the template's example transformer to the whole site.

## Notes

The spec is written against Leaflet's own class names (`leaflet-container`, `leaflet-tile-pane`,
`leaflet-marker-icon`) and Obsidian Leaflet's block syntax (`lat`, `long`, `height`,
`defaultZoom`, `marker: type, lat, long, [[link]]`), so it should hold once the plugin is
implemented; tile servers are answered locally by `helpers/offline.ts`. The control test (the
page builds) passes.
