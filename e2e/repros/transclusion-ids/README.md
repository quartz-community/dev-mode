---
title: "Transcluded content duplicates ids: footnotes and heading links jump to the wrong element"
issue: null
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# Transcluded content duplicates ids: footnotes and heading links jump to the wrong element

## Problem

Found in the renderTransforms survey. `renderTranscludes` copied the transcluded page's HTML with its
ids, so headings and footnotes (`user-content-fn-1`, `footnote-label`) appeared several times on a
page: the host's footnote [1] jumped to the transcluded note's footnote, and `[[#Details]]` inside a
transclusion to the host's heading. A heading transclusion (`![[source#Overview]]`) also brought
along the page's whole footnotes section.

## Steps

1. `just site-serve repro:transclusion-ids`
2. Open `/`, click the footnote references and "the details".

## Expected

Ids are unique on the page; links inside a transclusion go to its own heading and footnotes (or, from
a heading slice, to the source page); a heading transclusion holds only the footnotes it references.
