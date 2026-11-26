---
title: "Explorer ignores its `order` option"
issue: quartz-community/explorer#3
plugins: [explorer]
status: reproduced # fixed on an unmerged explorer branch (quartz-community/explorer#36–#39); set to fixed once released
---

# Explorer ignores its `order` option

## Problem

`order` (filter / map / sort) was written into the page but the client script always ran filter → map → sort, so a `mapFn` that strips Johnny.Decimal prefixes (`10 Zebra` → `Zebra`) reordered the folders alphabetically by their stripped names.

## Steps

`just repro-check explorer-order-option`. `mapFn` can only be set from TypeScript, so the spec puts it on the rendered explorer's `data-data-fns` and re-renders.

## Expected

With `order: [filter, sort, map]`: Zebra, Apple (numbered order). With the default: Apple, Zebra.

## Actual

Apple, Zebra in both cases. Fixed on explorer branch `dev-mode/order-option`.
