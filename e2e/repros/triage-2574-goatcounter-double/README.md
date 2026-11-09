---
title: "GoatCounter counts every landing page twice (#2574)"
issue: "jackyzha0/quartz#2574"
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# GoatCounter counts every landing page twice (#2574)

## Problem

count.js onload counts and registers the nav listener; production postscript imports component scripts before the router, so the initial nav is counted again.

## Steps

1. `just repro-check triage-2574-goatcounter-double` (strict) or `just site-serve repro:triage-2574-goatcounter-double`

## Expected

Asserted by repro.spec.ts.

## Actual

With count.js replaced by a local stub (content/gc-stub.js via analytics.scriptSrc) every direct page load records 2 count() calls; SPA navigation correctly records 1.

## Notes

Cause: repos/quartz/quartz/plugins/emitters/componentResources.ts:159-165 (+ postscript ordering :383-391). Fix: PR #2584 (register nav listener synchronously, count only on nav, queue until loaded).
