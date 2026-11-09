---
title: "Repro: layout.sidebars modes (scroll, static)"
issue: null
plugins: [explorer, table-of-contents]
status: fixed # open | reproduced | fixed | wontfix
---

# Repro: core-sidebar-modes

## Problem

Sidebars are always exactly one screen tall (`fit`); a component that doesn't shrink pushes
everything below it out of reach (jackyzha0/quartz#2463, #2514). `layout.sidebars` adds `scroll`
(the sidebar scrolls itself) and `static` (it scrolls away with the page).

## Expected (asserted by repro.spec.ts)

With `left: scroll`, the last of 60 explorer entries can be scrolled into view inside the
sidebar. With `right: static`, the right sidebar scrolls away with the page. On mobile both
behave as before.
