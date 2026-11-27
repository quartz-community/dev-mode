---
title: "TTRPG Tools: Maps: the map image ignores the base path"
issue: null
plugins: [obsidian-plugin-ttrpg-tools-maps]
status: reproduced # open | reproduced | fixed | wontfix
---

# TTRPG Tools: Maps: the map image ignores the base path

## Problem

With `baseUrl: localhost/sub` (a site under a sub-path, e.g. GitHub Pages project sites), a
map shows "Map failed to load" instead of its image and markers.

## Expected / Actual

Expected: the image is requested from `/sub/assets/world.svg` (where the emitter put it: the
control test fetches it with 200) and both markers are drawn. Actual: it is requested from
`/assets/world.svg`, which 404s; the image's `onerror` renders the error box.

## Root cause

`src/transformer.ts:316` (`resolveImageRef`) builds the URL as
`"/" + destRel.split("/").map(encodeURIComponent).join("/")`, a root-absolute path without the
site's base path, and the browser script (`ttrpg-map.inline.ts`, `resolveUrl()` /
`loadActiveBase()`) uses it as is. A relative URL from the page's slug, or resolving it in the
browser against the base path (e.g. `resolveBasePath` from `@quartz-community/utils`), would
work.

## Notes

The same map renders at the site root (`ttrpg-maps-render-spa`). Clone at origin/main (`d386f1d`,
1.0.2). Not fixed here.
