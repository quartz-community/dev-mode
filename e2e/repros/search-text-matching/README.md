---
title: "Search matches diacritics, folded tags and typographic quotes; excerpts show plain text"
issue: ""
plugins: [search]
status: fixed # open | reproduced | fixed | wontfix
---

# Search text matching

## Notes

With `configuration.slugs.stripDiacritics: true`:

- the query `creme` finds `Crème brûlée` and wraps `Crème` in `.highlight`;
- the tag `café` is stored as `cafe`, and both `#cafe` and `#café` find the page;
- the query `don't` highlights the typeset `don’t` (smartypants);
- a body of `"hello" & &lt;br&gt;` (shown as `“hello” & <br>`) appears in the excerpt as that
  text: no `&amp;`/`&quot;` entities, no `<br>` element.

The search script's excerpt also drops the last word of the text; that is
`search-excerpt-last-word`.
