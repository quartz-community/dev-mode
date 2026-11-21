---
title: "broken wikilinks in properties aren't marked broken"
issue: "jackyzha0/quartz#2635"
plugins: [note-properties]
status: fixed # open | reproduced | fixed | wontfix
---

# broken wikilinks in properties aren't marked broken (jackyzha0/quartz#2635)

## Notes

`configuration.links.disableBrokenWikilinks` adds `broken` to body links (core links built-in), but note-properties rendered property links itself. Fixed in note-properties: its html step lists the targets whose page doesn't exist (`brokenLinks`) and the component adds the `broken` class.
