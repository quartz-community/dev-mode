---
title: "Repro: link facts as in Obsidian"
issue: null
plugins: [obsidian-flavored-markdown, rehype-obsidian, utils, quartz]
status: fixed # open | reproduced | fixed | wontfix
---

# Repro: link facts as in Obsidian

## Problem

remark-obsidian 2.2.1's triage of another parser's oracle corpus handed five link facts to Quartz
(rendering and link classification, not parsing). Re-probed on Obsidian 1.15.0 with
`just obsidian-bases-probe e2e/repros/link-facts/obsidian-vault` (same note, numbered lines).

## Expected (asserted by repro.spec.ts)

- `[x](%zz)`, `[x](a%E2.md)`: a path that is not valid percent-encoding is an external link.
  Quartz crashed the build (`URI malformed` in `transformInternalLink`).
- `[x](../x:y)` is internal, `[x](x:y)` external (already so).
- Link paths are NFC: `[x](café.md)` links to `café.md`.
- `[text ^abc](café.md)` renders `text ` and names the paragraph `abc`; a wikilink's `^id`
  (`[[café#^xyz]]` → `café > ^xyz`, `[[café|al ^sss]]` → `al ^sss`) names nothing. Quartz
  stripped it and gave the paragraph the id.
- An unresolved embed shows its path: Markdown images decoded (`![](missing%20pic.png)` →
  “missing pic.png”), wikilinks as written (`![[missing%20file.png]]`). Wikilink image embeds
  take the path as alt when the alias is empty or only a size (`![[pic.png|100]]` → `pic.png`).

## Fix

- utils: `slugifyPath` NFC; `transformInternalLink` no longer throws; `linkPathDecodes`.
- core `links.ts`: undecodable path → external; alt for an unresolved image without one.
- rehype-obsidian: `a[data-wikilink]` text is never a block id. OFM marks wikilinks, removes the
  marker after, and defaults wikilink image alt to the path.
