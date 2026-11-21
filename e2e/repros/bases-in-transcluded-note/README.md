---
title: "Bases inside a transcluded note render the host's bases"
issue: null
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Bases inside a transcluded note render the host's bases

## Problem

Found in the renderTransforms survey: a base placeholder only held an index into the rendering
page's `basesBlocks`. Transcluded into another note, Source's inline ` ```base ` block and its
`![[Shelf.base]]` embed rendered the host's blocks with the same index, or stayed empty when the
host had none.

## Steps

1. `just site-serve repro:bases-in-transcluded-note`
2. Open `/` (host with its own base) and `/plain` (host without one).

## Expected

As Obsidian 1.15.1 renders it (`just obsidian-bases-probe`): the transcluded note's own bases, with
`this` being that note (`me` = Source), next to the host's own base.
