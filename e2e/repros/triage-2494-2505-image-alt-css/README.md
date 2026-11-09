---
title: "Per-image dark-mode invert (#2494) and centering (#2505) via alt text"
issue: "jackyzha0/quartz#2494"
plugins: [obsidian-flavored-markdown]
status: fixed # open | reproduced | fixed | wontfix
---

# Per-image dark-mode invert (#2494) and centering (#2505) via alt text

## Problem

Users want to flag single images to invert in dark mode (#2494) or to be centered (#2505), e.g. `![[diagram.png|invert|300]]`.

## Resolution

Documented (docs/features/wikilinks.md, "Styling individual images"): the alt text of an embed ends up in `img[alt]` (SVG: `object[aria-label]`), so a few lines of `custom.scss` keyed on words in the alt text do it. The spec injects the documented snippet (repros can't overlay styles) and checks it.

## Steps

1. `just repro-check triage-2494-2505-image-alt-css`

## Notes

`![alt|300](diagram.png)` (a Markdown image with Obsidian's size suffix) used to keep `|300` in the alt text and set no width; ofm now reads the size as Obsidian does (`E:` on the page). SVG embed attributes are now escaped.
