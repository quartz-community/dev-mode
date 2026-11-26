---
title: "Excalidraw sidebar toggle stops working after SPA navigation"
issue: "quartz-community/obsidian-plugin-excalidraw#15"
plugins: [obsidian-plugin-excalidraw]
status: reproduced # fixed on an unmerged plugin branch (see Notes); set to fixed once released
---

# Excalidraw sidebar toggle stops working after SPA navigation (quartz-community/obsidian-plugin-excalidraw#15)

## Problem

After one SPA navigation between Excalidraw pages, a click on the sidebar toggle does nothing.

## Steps

1. `just site-serve repro:excalidraw-15-sidebar-spa`, open `/boards/one.excalidraw`
2. SPA-navigate to `/boards/two.excalidraw`, click the sidebar toggle.

## Expected / Actual

Expected: one click opens the sidebar. Actual: nothing (after 2 navigations it works again, after 3 not…).

## Notes

`initSidebar()` added a click listener on every `nav`; its `addCleanup` only removed the class. The SPA
morphs the DOM and keeps the same toggle button, so listeners piled up and an even count toggled twice.
The zoom-in/out/reset buttons leaked listeners the same way (each held its own zoom state). Fix
(excalidraw branch `dev-mode/spa-listener-cleanup`): named handlers removed in `addCleanup`.
The spec ignores the offline unpkg font request.
