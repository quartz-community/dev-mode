---
title: "Links in bases ignore configuration.links"
issue: null
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Links in bases ignore configuration.links

## Problem

Found in the renderTransforms survey. Bases render their links when the page is rendered, after the
links built-in processed the note's own links: external links in a base had no external-link icon
and always opened in a new tab (whatever `openLinksInNewTab` says), and links from wikilink
properties had no `data-slug`.

## Steps

1. `just site-serve repro:bases-link-settings`
2. Compare the links in the base on `/` (and on `/shelf.base`) with the note's own links.

## Expected

Links in a base follow `configuration.links` like the note's own links.
