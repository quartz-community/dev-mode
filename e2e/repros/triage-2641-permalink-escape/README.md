---
title: "permalinks and aliases with `..` escape the output folder"
issue: "jackyzha0/quartz#2641"
plugins: [alias-redirects]
status: fixed # open | reproduced | fixed | wontfix
---

# permalinks and aliases with `..` escape the output folder (jackyzha0/quartz#2641)

## Notes

A permalink (core, `collectPermalinks`) or an alias (alias-redirects) with `..` segments was written relative to the output folder with no check. The sandbox builds into `<sandbox>/public`, so `../x` lands in `<sandbox>/x.html`, which the spec checks. Fixed by #2642 (core) and `aliasEscapesOutput` in alias-redirects.
