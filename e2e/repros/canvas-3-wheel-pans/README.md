---
title: "Canvas: two-finger scroll should pan, pinch / Ctrl + wheel should zoom"
issue: "quartz-community/canvas-page#3"
plugins: [canvas-page]
status: fixed # quartz-community/canvas-page#16 merged 2026-11-26 (canvas-page 1.1.4 on npm)
---

# Canvas: two-finger scroll should pan, pinch / Ctrl + wheel should zoom (quartz-community/canvas-page#3)

## Problem

Every wheel event zoomed the canvas, so a two-finger trackpad scroll zoomed instead of moving around;
panning needed a background drag. Obsidian (and Figma): wheel / two-finger scroll pans, Shift + wheel
pans sideways, Ctrl/Cmd + wheel and pinch zoom.

## Expected

Asserted with synthetic `WheelEvent`s (trackpad deltas, `ctrlKey` = Chromium/Firefox pinch, `metaKey`)
and one real `page.mouse.wheel`.

## Notes

Fix (canvas-page branch `dev-mode/trackpad-pan`, `canvas.inline.ts`): plain wheel pans by
`deltaX/deltaY` (line/page delta modes converted), Shift swaps the axis, Ctrl/Cmd zooms around the
pointer by `exp(±min(|delta|, 10) / 100)` (smooth for pinches, the old ~10% step for a mouse notch),
Safari `gesturestart/gesturechange` pinches zoom. Option `wheelBehavior: "zoom"` restores the old
"wheel always zooms" behaviour for mouse-first sites. Scrollable text nodes still scroll first.
Safari's gesture path is untested here (Chromium only).

A wheel over a text node whose text overflows (node `c`) scrolls the node first and pans the
canvas once the node is at its end (`scroll-cases.ts`, shared with `canvas-3-wheel-zoom-option`).
