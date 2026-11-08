---
title: "this.file.asLink() evaluation is broken in embedded bases"
issue: "quartz-community/bases-page#12"
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# this.file.asLink() evaluation is broken in embedded bases

## Problem

`People.base` is embedded (`![[People.base]]`) in `people/Alice.md` and `people/Bob.md` and filters
with `file.links.contains(this.file.asLink())` / `authors.contains(this.file.asLink())`.
https://github.com/quartz-community/bases-page/issues/12

## Expected

- Alice: `index` (links to Alice), `Solo Guide` (`authors: "[[Alice]]"`) and `Joint Guide` (`authors: ["[[Alice]]", "[[Carol]]"]`).
- Bob: `index` and `Bob Notes` (links to `[[Bob]]` in its body).

## Actual

Both pages list only `Solo Guide`; `Joint Guide` and `Bob Notes` never match.

## Notes

Root cause: the inline/embedded base self context was `{ file: { name, path, folder, ext } }`, not a
file value, so `this.file.asLink()` had no method target and evaluated to `undefined`; the scalar
`"[[Alice]]".contains(undefined)` then matched `""` on every page, and list/`file.links` lookups never
matched. Fixed in bases-page `dev-mode/this-context` (9cda99f): `this.file` is the embedding note's
full file value (`buildSelfContext`), `contains()` resolves wikilink needles to the file they point at,
and a missing needle matches nothing. Builds on `parseWikilink()` from bases-page PR #16.
