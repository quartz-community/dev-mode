---
title: "Layout condition has-backlinks is always false"
issue: null
plugins: [backlinks]
status: reproduced   # open | reproduced | fixed | wontfix
---

# Layout condition has-backlinks is always false

## Problem
Core's built-in layout condition `has-backlinks` (`repos/quartz/quartz/plugins/loader/conditions.ts:11`) reads `fileData.backlinks`, which nothing produces — backlinks are derived at render time from `allFiles[].links`. So `layout: { condition: has-backlinks }` hides the component on every page.

Fix idea: compute the predicate from `props.allFiles` (any file whose `links` include `props.fileData.slug`), mirroring the Backlinks component, or have the backlinks plugin register its own condition via `registerCondition`.

Found by the static catalog: `just catalog who-writes backlinks` (2026-11-07).

## Steps
1. `just repro-build core-has-backlinks-condition` (or `just site-serve repro:core-has-backlinks-condition`)
2. Open `/` …

## Expected
<!-- Asserted by repro.spec.ts -->

## Actual

## Notes
<!-- Root cause, affected plugins (`just catalog impact <plugin>`), fix PR links. -->
