---
title: "Flex groups work in the header slot"
issue: null
plugins: [search]
status: fixed  # open | reproduced | fixed | wontfix
---

# Repro: core-layout-header-group

## Problem
Regression guard: `KNOWN_LIMITATIONS.md` claimed header/footer components could not use `group`. They can — `resolveGroups` runs for every slot and the frames render the resulting Flex component inside `<header>`. This repro keeps it that way.

## Steps
1. `just repro-build core-layout-header-group` (or `just site-serve repro:core-layout-header-group`)
2. Open `/` …

## Expected
<!-- Asserted by repro.spec.ts -->

## Actual

## Notes
<!-- Root cause, affected plugins (`just catalog impact <plugin>`), fix PR links. -->
