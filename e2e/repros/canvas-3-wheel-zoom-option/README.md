---
title: "Canvas: wheelBehavior (and every other canvas-page display option) is ignored"
issue: "quartz-community/canvas-page#3"
plugins: [canvas-page]
status: fixed # open | reproduced | fixed | wontfix
---

# Canvas `wheelBehavior: zoom` is ignored

## Problem

With `wheelBehavior: zoom` (the option from the canvas-page#3 fix, see `canvas-3-wheel-pans`) a
plain wheel should zoom around the pointer, as before #3. It still pans: the page has
`data-wheel-behavior="pan"`.

## Notes

`CanvasPage(opts)` stores the options in the virtual page's data (`canvasOptions: opts`), but
the page body is `CanvasBody_default`, which reads only its own `userOpts`, and Quartz's
page-type dispatcher calls it as `pageType.body(undefined)`
(`quartz/plugins/pageTypes/dispatcher.ts`). So `userOpts` is always undefined and every
display option the body reads — `enableInteraction`, `initialZoom`, `minZoom`, `maxZoom`,
`wheelBehavior` — falls back to its default (canvas-page 1.1.4 on npm; main has the same
code). Fix: read `fileData.canvasOptions` in `CanvasBody` (falling back to `userOpts`).

The spec expects: the option on the page; a plain wheel zooming by `exp(±min(|delta|, 10) / 100)`
with the point under the pointer staying put; Shift + wheel zooming too; and, shared with
canvas-3-wheel-pans (`scroll-cases.ts` there), a wheel over an overflowing text node scrolling
the node first and zooming once it is at its end. Content copied from canvas-3-wheel-pans.

Checked: with `data-wheel-behavior="zoom"` forced on the container before the canvas script
runs (an init script), the whole spec passes, so it fails only on the missing option.
