---
title: "broken-link marking after filtering and page generation"
issue: "Quartz 5.3 (configuration.links.disableBrokenWikilinks on by default)"
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# broken-link marking after filtering and page generation

## Notes

Quartz 5.3 turns `configuration.links.disableBrokenWikilinks` on by default, and marks links whose target
isn't emitted only after the filters and page types ran (core `builtins/links.ts`, `build.ts`
`markRemovedLinks`, `pageTypes/dispatcher.ts` `markLinksToUnpublishedPages`):

- a link to a page a filter removed (a draft, or its alias) → `broken` + `data-filtered="<filter>"`;
- a link to a folder or tag page no page type generated → `broken` + `data-missing`;
- a link to a page that doesn't exist → `broken` (the Links transformer itself).

Nothing else may be marked: published pages, a folder note (`projects/index.md`, a content page no
page type generates), a folder with a published note, a used tag, and files Quartz emits
(`index.xml`). The spec also fetches every link target, so a mark always agrees with whether the
page exists.

Unit tests in core cover the same functions, including watch mode (`builtins.test.ts`,
`dispatcher.test.ts`); this repro covers the wiring through a real build.
