---
title: "Search excerpt drops the last word of the text and adds an ellipsis"
issue: ""
plugins: [search]
status: fixed # open | reproduced | fixed | wontfix
---

# Search excerpt drops the last word

## Notes

A page whose text is `Alpha beta gamma omega.` shows as `Alpha beta gamma...` in the search
results: the last word is gone and an ellipsis claims the text goes on.

`highlight()` in `src/components/scripts/search.inline.ts` (search 1.1.2 on npm, and the repo's
main) takes the context window with

```ts
endIndex = Math.min(
  startIndex + 2 * contextWindowWords,
  tokenizedText.length - 1,
);
tokenizedText = tokenizedText.slice(startIndex, endIndex);
```

`endIndex` is an inclusive index (`length - 1`) but `slice` excludes it, so the window always
ends one word early. The `...` suffix is then decided by comparing `endIndex` with the length
of the already-sliced array, which is never equal for a short text. Fix: slice to
`endIndex + 1` (or make `endIndex` exclusive and compare against the original length).
