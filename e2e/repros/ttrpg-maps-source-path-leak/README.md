---
title: "TTRPG Tools: Maps: published HTML contains the builder's absolute file paths"
issue: null
plugins: [obsidian-plugin-ttrpg-tools-maps]
status: reproduced # open | reproduced | fixed | wontfix
---

# TTRPG Tools: Maps: the builder's file paths end up in the published HTML

## Problem

Each map's `data-qz-ttrpg-map-cfg` attribute includes `resolvedImageUrls[].sourcePath`, the
absolute path of the image on the machine that built the site, e.g.
`/home/<user>/<vault>/content/assets/world.svg`. Every published map page discloses the
builder's user name and directory layout.

## Expected / Actual

Expected: the HTML contains `url` / `destRel` only. Actual: it contains `sourcePath` with the
absolute path of this repro's `content/` folder.

## Root cause

`src/transformer.ts:326-331` (`buildPlaceholder`) serialises `resolved.resolvedImageUrls`
as is, including `sourcePath` (needed only by the emitter, `src/emitter.ts`, to copy the file).
The browser script (`ttrpg-map.inline.ts:163-173`) only uses `sourcePath` as an extra lookup
key. Fix: drop `sourcePath` from the serialised config.

## Notes

The map itself works (asserted after the check). Clone at origin/main (`d386f1d`, 1.0.2). Not
fixed here.
