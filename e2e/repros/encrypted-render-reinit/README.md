---
title: "Unlocking an encrypted page sets components up a second time"
issue: null
plugins: [encrypted-pages, darkmode, reader-mode, syntax-highlighting, comments]
status: fixed # open | reproduced | fixed | wontfix
---

# Unlocking an encrypted page sets components up a second time

## Problem

encrypted-pages dispatches `render` after it decrypts a page (and again after the shadow content
index of an unlisted page was patched in). Components that set themselves up on `render` did so a
second time on the same page:

- darkmode / reader-mode added another click listener each time, so one click toggled two or three
  times (an even number looks like "the button does nothing");
- syntax-highlighting added another copy button to every code block;
- comments appended giscus' `client.js` again.

And after an unlisted page was unlocked, encrypted-pages dispatched `content-index-updated` and
`render` on every later navigation, so this happened on every page.

## Expected (asserted by repro.spec.ts)

With `unlistWhenEncrypted: true`, after unlocking `/Secret` (password `hunter2`): one copy button
per code block, one `themechange` / `readermodechange` per click (and the `saved-theme` /
`reader-mode` attribute flips), one `client.js` script in `.giscus` and one request for it
(giscus.app is answered by `page.route` with an empty script). Then an SPA click to `/Normal`
dispatches no `render` and no `content-index-updated`; an SPA click back to `/Secret` dispatches
exactly one `render` (the page unlocks itself with the cached password), and both pages still have
one of everything.

## Notes

Fixed (unreleased at the time of writing) in darkmode, reader-mode, syntax-highlighting and
comments (setup is idempotent: module-scope handlers, skip blocks/containers that already have a
button/giscus) and encrypted-pages (`content-index-updated` + `render` only when the shadow patch
added entries). Fails with the released encrypted-pages 1.3.0, darkmode 1.0.2, reader-mode 1.0.2,
syntax-highlighting 1.0.4 and comments 1.0.2.
