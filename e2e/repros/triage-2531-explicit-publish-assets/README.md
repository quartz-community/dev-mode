---
title: "Assets from unpublished notes are emitted with explicit-publish"
issue: "jackyzha0/quartz#2531"
plugins: [explicit-publish]
status: reproduced # open | reproduced | fixed | wontfix
---

# Assets from unpublished notes are emitted with explicit-publish (jackyzha0/quartz#2531)

Triage 2026-11-07 against dev-mode branches (quartz dev-mode/improvements, ofm dev-mode/pele).

## Notes

Core Assets emitter globs the content dir, ignoring filtered content; secret-diagram.png (only referenced by publish:false note) is served. Related PR #2544.
