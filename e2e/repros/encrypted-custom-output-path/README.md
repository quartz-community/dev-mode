---
title: "Encrypted pages: a custom shadow index outputPath was never fetched"
issue: null
plugins: [encrypted-pages, explorer, search]
status: fixed # open | reproduced | fixed | wontfix
---

# Encrypted pages: custom `outputPath` for the shadow content index

## Problem

With `unlistWhenEncrypted: true`, the emitter writes the encrypted shadow content index to
`outputPath`, but the browser script always fetched `static/encryptedContentIndex.json`. With any
other `outputPath` the fetch 404'd, so an unlocked unlisted page never appeared in graph, explorer
or search.

## Expected (asserted by repro.spec.ts)

Site under the base path `/sub`, `outputPath: data/shadow.json`. After unlocking `/sub/hidden`
(password `hunter2`), the browser fetched `/sub/data/shadow.json` (200, nothing requested from
`static/encryptedContentIndex.json`), and "Hidden Treasure" shows in the explorer and in search
results. Before unlocking, it is in neither.

## Notes

Fixed (unreleased at the time of writing) in encrypted-pages: the emitter adds an inline script
setting `window.__encryptedPagesShadowIndexPath` when `outputPath` isn't the default; the browser
script resolves it against the site root. Fails with the released encrypted-pages 1.3.0.
