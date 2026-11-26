---
title: "Single-tilde strikethrough cannot be turned off"
issue: "quartz-community/github-flavored-markdown#2"
plugins: [github-flavored-markdown]
status: reproduced # set to fixed once the fix branch is in the workspace (passes with it)
---

# Single-tilde strikethrough cannot be turned off

## Problem

remark-gfm strikes `~text~` by default, so `about ~20 W here and (~€120) there` loses text to a
strikethrough nobody wrote. Only without obsidian-flavored-markdown's default `legacy` parser
(OFM disabled, as here, or `preset: strict`): `legacy` parses as Obsidian, where single tildes
never strike.

## Expected

`singleTilde: false` (github-flavored-markdown option, passed to remark-gfm) strikes only `~~text~~`.

## Notes

Fix: github-flavored-markdown branch `dev-mode/single-tilde` adds `singleTilde` (default `true`,
as before). Checked by hand under `preset: strict` too.
