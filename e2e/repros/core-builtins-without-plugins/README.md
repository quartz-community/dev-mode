---
title: "Core features silently break without note-properties / crawl-links / remove-draft / content-index"
issue: null
plugins: [note-properties, crawl-links, remove-draft, content-index]
status: fixed # open | reproduced | fixed | wontfix
---

# Core features silently break without note-properties / crawl-links / remove-draft / content-index

## Problem

Four default plugins did work every site depends on:

- **note-properties** parsed frontmatter → without it every page was titled "Untitled", tags and
  aliases vanished and `draft: true` pages were published.
- **crawl-links** made internal links relative and filled `file.data.links` → without it 13 links
  404'd on the bug-repro fixture and backlinks / graph / `has-backlinks` were empty.
- **remove-draft** hid drafts; **content-index** emitted `contentIndex.json` (search, explorer, graph).

Disabling or misordering any of them broke the site with no error (`just site-smoke` even reported
"No problems found" for the missing frontmatter).

## Steps

1. `just repro-check core-builtins-without-plugins`
2. The config enables only content-page, obsidian-flavored-markdown and backlinks.

## Expected

Titles and tags from frontmatter, relative internal links, backlinks (also from links inside
frontmatter properties), drafts not published, `static/contentIndex.json` with titles/tags/links.

## Actual (before fix)

"Untitled" titles, no tags, broken links, empty backlinks, the draft published, no contentIndex.json.

## Notes

Fixed in repos/quartz (branch dev-mode/improvements): `quartz/plugins/builtins/` — frontmatter,
links, drafts and contentIndex are core built-ins configured under `configuration.frontmatter`,
`.links`, `.drafts`, `.contentIndex`. Old config entries for crawl-links / remove-draft /
content-index are applied automatically (`npx quartz plugin doctor --fix` rewrites them).
note-properties now only renders the properties panel.
