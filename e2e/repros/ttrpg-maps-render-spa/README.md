---
title: "TTRPG Tools: Maps renders zoommap blocks and survives SPA navigation"
issue: null
plugins: [obsidian-plugin-ttrpg-tools-maps]
status: fixed # open | reproduced | fixed | wontfix
---

# TTRPG Tools: Maps: render and SPA navigation

First browser test of `obsidian-plugin-ttrpg-tools-maps` (not a Quartz dependency: loaded from
the workspace clone with a local `source:`).

## Expected (asserted by repro.spec.ts)

- `/world-map`: a ` ```zoommap ` block with `image:` and a sidecar `markers:` JSON becomes
  `.zm-root` (initialised, 300px high), the image loads (natural width 800) and both markers are
  drawn inside the map with their tooltips; the mouse wheel over the map changes the
  `.zm-world` transform (zoom).
- `/inline-map`: `storage: note` with a `ZOOMMAP-DATA id=…` block in the note renders its one
  marker; the data block is not shown.
- SPA navigation World Map → Inline Map → World Map → Back, then to a page without a map: each
  page has exactly its own map (one root, its markers), nothing is left behind, no page load,
  no page errors.

## Notes

Passes with the clone at origin/main (`d386f1d`, 1.0.2). The image is a small SVG. Under a base
path the map breaks, and the HTML carries the builder's file paths: see
`ttrpg-maps-base-path` and `ttrpg-maps-source-path-leak`.
