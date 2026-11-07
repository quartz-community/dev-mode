---
title: "Footer: custom text that isn't a link (#2444)"
issue: "jackyzha0/quartz#2444"
plugins: [footer]
status: fixed # open | reproduced | fixed | wontfix
---

# Footer: custom text that isn't a link (#2444)

## Problem

In v4 people edited `quartz/components/Footer.tsx` to add a line to the footer. In v5 the footer is an installed plugin (edits in `.quartz/plugins/` don't compile), and its only option was `links`.

## Fix

Footer `message` option (HTML allowed), plus the docs page `customizing components.md` on the v5 ways to change a component (options, layout, `custom.scss`, a local copy of the plugin).

## Steps

1. `just repro-check triage-2444-footer-message`

## Expected

Asserted by repro.spec.ts: the message renders as HTML between the Quartz line and the links.
