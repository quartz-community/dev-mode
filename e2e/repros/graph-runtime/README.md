---
title: "Graph at runtime: idle when settled, lazy libraries, folder pages visited"
issue: ""
plugins: [graph]
status: fixed # open | reproduced | fixed | wontfix
---

# Graph at runtime

## Notes

`graph.inline.ts` (graph 1.0.8):

- Renders on demand (`autoStart: false`, `requestRender` per simulation tick): once the d3
  layout settles, no `requestAnimationFrame` calls are made (the spec counts them over a
  second). Also after the global graph is opened and closed (also while still animating), and
  after an SPA navigation away while the layout animates.
- d3 and PixiJS load from jsDelivr only when a graph is first drawn: at phone width the local
  graph sits far below the article, and nothing is requested until it is scrolled into view
  (IntersectionObserver with a 200 px margin).
- `localStorage["graph-visited"]` records a folder page as `projects/example/`, on a direct
  load and after an SPA navigation.
