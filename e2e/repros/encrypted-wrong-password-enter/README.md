---
title: "Encrypted page: wrong password, and unlocking with Enter"
issue: null
plugins: [encrypted-pages]
status: fixed # open | reproduced | fixed | wontfix
---

# Encrypted page: wrong password, and unlocking with Enter

The other encrypted repros unlock with the right password and a click on Unlock. This one covers
the rest of the form in `encrypted.inline.ts`.

## Expected (asserted by repro.spec.ts)

`/Secret` (password `hunter2`, `iterations: 1000`):

- A wrong password, submitted with the button or with Enter, shows
  "Incorrect password. Please try again.", clears and focuses the input, re-enables the form,
  and the page stays locked (`.encrypted-page[data-encrypted]` still there, no content). The
  wrong password is not kept in `sessionStorage`, so a reload is locked too.
- Enter on an empty input does nothing (no error, no "Decrypting…").
- Enter with the right password after a wrong one unlocks the page (error gone, content and code
  block shown); the password is remembered, so after an SPA navigation away and back the page
  unlocks by itself.

## Notes

Passes with the released encrypted-pages 1.3.1. External requests (fonts) are answered locally
by `helpers/offline.ts`.
