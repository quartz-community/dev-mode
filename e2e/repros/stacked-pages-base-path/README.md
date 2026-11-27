---
title: "Stacked pages: tabs doubled the base path"
issue: null
plugins: [stacked-pages]
status: fixed # open | reproduced | fixed | wontfix
---

# Stacked pages under a base path

## Problem

The binder stored each tab's slug from `location.pathname`, base path included (`sub/first`), and
`navigateToTab` added the base path again: on a site served under `/sub`, clicking a tab opened
`/sub/sub/first`, a 404.

## Expected (asserted by repro.spec.ts)

Open `/sub/first`, click the link to Second (SPA), click the First tab in the binder: the URL is
`/sub/first` (no `/sub/sub/`), the page was fetched with 200 and shows First, and nothing 404'd.

## Notes

Fixed (unreleased at the time of writing) in stacked-pages: `getCurrentSlug()` strips the base path
(`getBasePath()` from utils). Fails with the released stacked-pages 1.0.3.
