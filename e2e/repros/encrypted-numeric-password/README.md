---
title: "Encrypted pages: a numeric (or non-text) password published the page in the clear"
issue: null
plugins: [encrypted-pages]
status: fixed # open | reproduced | fixed | wontfix
---

# Encrypted pages: numeric and non-text passwords

## Problem

YAML reads `password: 1234` as a number. encrypted-pages only encrypted pages whose password was a
string, so such a page was published unencrypted, without a warning. Same for `password: [a, b]`
(a list) or `true`.

## Expected (asserted by repro.spec.ts)

From the encrypted-pages README (frontmatter fields): "A number (`password: 1234`) is used as its
string form (`0042` reads as `42`: quote it to keep the zeros). Any other value (a list, `true`)
locks the page for everyone and warns at build time."

- `/number` (`password: 1234`) is encrypted and unlocks with `1234`;
- `/zeros` (`password: 0042`) is encrypted and unlocks with `42`, not `0042`;
- `/list` (`password: [a, b]`) is encrypted, `a`, `b` and `a,b` don't open it, and its text is not
  in the served HTML.

## Notes

Fixed (unreleased at the time of writing) in encrypted-pages (`textPassword()`: numbers use their
string form; any other non-empty value encrypts with a random key and warns). Fails with the
released encrypted-pages 1.3.0, where all three pages are served in the clear.
