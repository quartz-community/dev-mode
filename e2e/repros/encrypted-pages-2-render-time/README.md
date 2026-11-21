---
title: "Encrypted pages encrypt the placeholders of bases and transclusions"
issue: "quartz-community/encrypted-pages#2"
plugins: [encrypted-pages, bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Encrypted pages encrypt the placeholders of bases and transclusions (quartz-community/encrypted-pages#2)

## Problem

encrypted-pages encrypts a note in the transformer phase (`htmlPlugins`). Bases (page types'
`treeTransforms`) and transclusions (`renderTranscludes`) are filled in later, when the page is
rendered, so what gets encrypted is their empty placeholder: the unlocked page shows nothing where
the base or the transcluded note should be.

## Steps

1. `just site-serve repro:encrypted-pages-2-render-time`
2. Open `/locked`, unlock with `secret`.

## Expected

The unlocked page shows the base's table and the transcluded note, like `/` does.
