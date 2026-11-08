---
title: "Short wikilinks to a folder note resolve to a nonexistent root-level path"
issue: "quartz-community/utils#4"
plugins: [utils, crawl-links]
status: fixed # open | reproduced | fixed | wontfix
---

# Short wikilinks to a folder note resolve to a nonexistent root-level path

## Problem

`slugifyFilePath` gives the folder note `Area/Topic/Topic.md` the slug `area/topic/index`, but the
`shortest` strategy of `transformLink` (utils) matches a one-segment link against the slug's last
segment (`index`), so `[[Topic]]` from `notes/source` becomes `../topic`, which doesn't exist.
(The folder note has to be nested: at the root, the wrong `../topic` happens to be the folder.)

## Expected

Asserted by `repro.spec.ts`: both `[[Topic]]` and `[[Topic#Section]]` open the folder note.

## Notes

Fix: utils `transformLink` (`shortest`) retries a one-segment target against `<name>/index` when no
file matches (community PR quartz-community/utils#5, by alastairsounds), branch
`dev-mode/heading-slugs` in repos/utils.
