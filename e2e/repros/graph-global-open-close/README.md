---
title: "Graph: opening and closing the global graph"
issue: null
plugins: [graph]
status: fixed # open | reproduced | fixed | wontfix
---

# Graph: opening and closing the global graph

Browser coverage for the global graph in `graph.inline.ts` without the network: the d3 and
PixiJS scripts (jsDelivr) are replaced by the stand-ins of `helpers/graph-stub.ts`, which
accept any call, create a real `<canvas>` for each PixiJS application and count simulations,
`init` and `destroy`. So this tests the plugin's own wiring (loading, open / close, cleanup),
not d3's layout or PixiJS's drawing; repro `graph-runtime` covers those with the real
libraries (from the network).

## Expected (asserted by repro.spec.ts)

- The local graph is drawn into `.graph-container`. The `.global-graph-icon` button opens
  `.global-graph-outer.active` with a visible canvas and a simulation over more nodes than the
  local one (every page); Escape closes it and destroys its application. d3 and PixiJS are
  requested once each.
- Ctrl+G opens and closes it; a click inside the graph keeps it open, a click outside closes
  it; the button opens it (once open, the overlay covers the button).
- After three SPA navigations the button, Ctrl+G and Escape still toggle it once per action
  (no stacked listeners). Back while it is open shows the previous page with the global graph
  closed and its application destroyed; only the local graph's application is left. No page
  load, no page errors.

## Notes

Passes with the released graph 1.0.9. On a direct load the local graph is drawn twice; that
bug is in its own repro, `graph-double-render-direct-load`, and the specs here count around it.
