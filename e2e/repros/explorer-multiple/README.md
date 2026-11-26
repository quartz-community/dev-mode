---
title: "Two explorers, one with rootFolder"
issue: quartz-community/explorer#12
plugins: [explorer]
status: reproduced # fixed on an unmerged explorer branch (quartz-community/explorer#36–#39); set to fixed once released
---

# Two explorers, one with rootFolder

The full explorer plus a second entry with `rootFolder: Notes`. Before: no rootFolder, duplicated `<template>` ids, and one copy of the explorer script per instance, each rendering every explorer. Expected: second explorer shows only Notes, no duplicate ids, both work and re-render on SPA navigation.

Run: `just repro-check explorer-multiple`. Fixed on explorer branch `dev-mode/multiple-explorers`.
