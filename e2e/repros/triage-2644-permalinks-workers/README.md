---
title: "permalinks are lost in worker threads"
issue: "jackyzha0/quartz#2644"
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# permalinks are lost in worker threads (jackyzha0/quartz#2644)

## Notes

Quartz parses in worker threads at 192 or more files (threads = round(files / 128)). The context passed to them (`parse.ts`) left out `ctx.permalinks`, so a permalinked note was published at its file path and links pointed there. Fixed by #2644 plus `workerCtx()` in `quartz/util/ctx.ts`, which lists every plain-data field as required. The 200 notes in `content/filler/` are what make the build use threads.
