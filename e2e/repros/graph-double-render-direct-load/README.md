---
title: "Graph: the local graph is drawn twice on a direct page load"
issue: null
plugins: [graph]
status: fixed # quartz-community/graph#39 merged 2026-11-27 (graph 1.0.10)
---

# Graph: the local graph is drawn twice on a direct page load

## Problem

On a direct load of a page (not an SPA navigation), the local graph is set up twice when d3 and
PixiJS are available quickly (e.g. from the browser cache): two d3 simulations are started and
two PixiJS applications (two WebGL contexts) are created; the first is destroyed as soon as its
setup finishes. Nothing is visibly wrong, but the work is done twice on every page load.

## Expected / Actual

Expected: one simulation, one PixiJS application (`simulations: [3]`, `apps: 1`). Actual:
`simulations: [3, 3]`, `apps: 2`, `destroyed: 1`. After an SPA navigation the new page's graph
is drawn once (control test).

## Root cause

`graph.inline.ts` (graph 1.0.9, `src/components/scripts/graph.inline.ts:767-779` on main)
calls `handleNav()` itself when the script runs (`document.readyState !== "loading"`) and also
listens for `nav`. Quartz's router is a separate script (`componentResources.ts` pushes
`spa.inline.ts` after the component scripts; `spa.inline.ts:316` dispatches the first `nav`),
and that `nav` arrives after the `load` event. The first `renderLocal()` has by then passed its
generation check (the libraries had loaded), so it creates an application and starts a
simulation. The second `renderLocal()` bumps the generation, so the first render's cleanup runs
as soon as it resolves (`render()` in `renderLocal`). Confirmed by delaying the library
responses by 1.5 s: the first render is then dropped at the generation check and the spec
passes.

Fix options: drop the self-call and rely on the first `nav` (the router and the no-SPA shim both
dispatch one), or skip a `nav` for the slug already rendered.

## Notes

d3 / PixiJS are the stand-ins of `helpers/graph-stub.ts` (served at once, as from a cache),
which count `forceSimulation` calls and PixiJS `init` / `destroy`. Not fixed here.
