---
title: "Callout body text leaks into title"
issue: "jackyzha0/quartz#2437"
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# Callout body text leaks into title

## Problem

Example repro kept as a template: bold text in a nested callout body leaked into the callout title. Fixed upstream; the spec now passes.
<!-- What goes wrong, in one or two sentences. Link the issue. -->

## Steps

1. `just repro-build example-callout-title` (or `just site-serve repro:example-callout-title`)
2. Open `/` …

## Expected

<!-- Asserted by repro.spec.ts -->

## Actual

## Notes

<!-- Root cause, affected plugins (`just catalog impact <plugin>`), fix PR links. -->
