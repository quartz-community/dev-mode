---
title: "configuration.theme.typography ignored with quartz-fonts (#2507)"
issue: "jackyzha0/quartz#2507"
plugins: [fonts]
status: fixed # open | reproduced | fixed | wontfix
---

# configuration.theme.typography ignored with quartz-fonts (#2507)

## Problem

With @quartz-community/quartz-fonts enabled (default), changing configuration.theme.typography has no visible effect.

## Steps

1. `just repro-check triage-2507-typography-ignored` (strict) or `just site-serve repro:triage-2507-typography-ignored`

## Expected

Asserted by repro.spec.ts.

## Actual

Core requests Lora/Fira Code from Google Fonts, but computed families stay Schibsted Grotesk / Source Sans Pro / IBM Plex Mono.

## Notes

Cause: repos/fonts/src/transformer.ts:62-80 falls back to hard-coded QUARTZ_DEFAULT_* (lines 9-11) instead of ctx.cfg.configuration.theme.typography; its @layer quartz-fonts vars beat core's @layer quartz-base vars and its unlayered h1-h6 rules (:212) win outright. Same for buildGoogleFontsHead (:175-177) and emitter.ts:35-37. Fix idea: use configuration.theme.typography as the fallback before the Quartz defaults.
