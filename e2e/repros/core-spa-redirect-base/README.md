---
title: "Repro: SPA navigation through a redirect keeps relative links working"
issue: null
plugins: [folder-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Repro: core-spa-redirect-base

## Problem

Static hosts redirect a folder URL without its trailing slash (`/base/notes` → `/base/notes/`).
The SPA router fetched the redirected page but resolved its relative links against the URL it
requested, so links on folder pages (and parent tag pages, jackyzha0/quartz#2556) pointed one
level too high after an SPA click on a slash-less link.

## Expected (asserted by repro.spec.ts)

After an SPA click to `./notes`, the address bar shows `/spa-base/notes/` and the folder
listing's link opens the note.

## Notes

Fix: `spa.inline.ts` uses the response URL (`res.url`) for `normalizeRelativeURLs` and
`history.pushState`. dev-mode's static server now redirects directories like real hosts.
