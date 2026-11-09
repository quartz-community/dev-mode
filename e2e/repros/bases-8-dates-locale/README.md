---
title: "Repro: bases dates follow Obsidian and the site's locale"
issue: quartz-community/bases-page#8
plugins: [bases-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Repro: bases dates follow Obsidian and the site's locale (bases-page#8)

## Problem

Dates rendered as JSON (`"2024-03-05T00:00:00.000Z"`) or raw ISO text whatever the locale, and
`date()` guessed with JS `Date` (`05/03/2024` became May 3).

## Expected (Obsidian 1.15.0, obsidian-bases-probe q5-dates, app language de)

Dates as moment `L` (`05.03.2024`), datetimes as `L LT`; `format()` with German names;
`date("05/03/2024")` is empty.

## Notes

Site locale `de-DE` via the config overlay. Fixed in bases-page (values.ts date display, strict date()).
