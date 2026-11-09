---
title: "Heading ids, heading links and TOC entries are slugged by different rules"
issue: quartz-community/crawl-links#4
plugins:
  [
    github-flavored-markdown,
    table-of-contents,
    crawl-links,
    obsidian-flavored-markdown,
  ]
status: fixed # open | reproduced | fixed | wontfix
---

# Heading ids, heading links and TOC entries are slugged by different rules

Covers quartz-community/crawl-links#4, crawl-links#10, table-of-contents#3 and
github-flavored-markdown#3.

## Problem

Heading `id`s come from `rehype-slug` (github-flavored-markdown) over the rendered heading text;
links to headings are slugged by `splitAnchor` (utils, via core links / crawl-links) or OFM's own
`github-slugger` call; TOC entries by table-of-contents' own slugger in the Markdown stage. They
disagree, so links miss:

- same-page `[x](<#Heading text>)` is only percent-encoded, never slugged (crawl-links#4);
- `[[other#Colon unspaced]]` — Obsidian's anchor for `## Colon:unspaced` — slugs to
  `colon-unspaced`, the heading's id is `colonunspaced` (crawl-links#10);
- SmartyPants turns `## Range 1--2` into `Range 1—2` before `rehype-slug` runs, so its id is
  `range-12`, not GitHub's `range-1--2` (github-flavored-markdown#3);
- the TOC counts duplicates only among headings within `maxDepth`, so `#### Foo` + `## Foo` makes
  the TOC link the h2 as `#foo`, which is the h4 (table-of-contents#3).

## Expected

Asserted by `repro.spec.ts`: every same-page anchor, cross-note heading link and TOC entry names
an id on the target page, and the TOC entry reaches the right heading.

## Notes

Root cause: three slug implementations over three different inputs — `rehype-slug` over the
rendered (SmartyPants-rewritten) heading text, `splitAnchor`/OFM `github-slugger` over the link
anchor, and table-of-contents' own `github-slugger` over the Markdown text, counting only
headings within `maxDepth`. Same-page `#anchor` links were never slugged at all.

Fix (branches `dev-mode/heading-slugs`):

- utils: shared `slugHeading` / `HeadingSlugger` (github-slugger, so existing ids are unchanged),
  `obsidianHeadingAnchor`, `resolveAnchorHref`; `splitAnchor` uses `slugHeading`.
- github-flavored-markdown: replaces `rehype-slug` with its own step using `HeadingSlugger` over
  the heading as written (SmartyPants rewrites undone), adds Obsidian's anchor as an alias id
  (`<span id="colon-unspaced" class="heading-alias">`) when it differs from every id, and points
  same-page `#anchor` links at the heading ids (core's built-in links skip `#` hrefs).
- table-of-contents: entries take their slug from the heading's real `id` in the HTML stage.
- crawl-links: same-page `#anchor` links through `resolveAnchorHref` (for sites still on it).

Only id that changes: headings with `--` under SmartyPants (`range-12` → `range-1--2`, GitHub's).
Known gap: core's header transclusion (`![[note#Colon unspaced]]`, renderPage.tsx) matches only the
heading's own id, not the alias span.
