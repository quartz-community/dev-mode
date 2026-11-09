---
name: plugin-dataflow
description: Understand what Quartz plugins do and how they interact — which plugin produces or consumes which file.data key, which plugin renders/styles/scripts a DOM element or CSS class, pipeline order, hidden cross-plugin dependencies, and the blast radius of a change. Use before changing a plugin's data, markup, CSS or options, when debugging "data missing / undefined" issues, or when asked how plugins relate.
---

# Plugin data flow and interactions

Two complementary sources:

| | Static catalog (`just catalog …`) | Runtime trace (`just trace <target>`) — prototype |
|---|---|---|
| How | TypeScript AST over `repos/*/src` + manifests | instrumented sandbox build (Proxy on `file.data`, per-plugin context) |
| Covers | every package, all code paths, DOM classes, CSS, scripts, emitted files | only what this site/config/content actually exercises |
| Answers | "who *can* write `links`?" | "who *did* read `links` on this site, how often, in what order?" |
| Output | `.dev/catalog/{CATALOG,DATA-FLOW}.md`, `catalog.json` | `.dev/trace/<name>/TRACE.md`, `trace.json` |

The catalog rebuilds itself when sources are newer than `.dev/catalog/catalog.json` (`just catalog build` forces it).

## Questions → commands

```bash
just catalog show <plugin>          # card: category, order, hooks, options, components+positions,
                                    # data written/read, classes rendered/styled, scripts, deps, tests
just catalog who-writes <key>       # producers of file.data.<key> (with file:line and DataMap type)
just catalog who-reads <key>        # consumers — check BEFORE renaming/removing/reshaping a key
just catalog dom <class|#id>        # who renders / styles / scripts it (find hidden DOM coupling)
just catalog impact <package>       # dependents, data consumers, fixtures/specs, verification commands
just catalog search <text>          # fuzzy over names, descriptions, keys, classes
just trace fixture:bug-repro        # runtime truth + anomalies for a real build (~3 s)
```
All accept `--json`.

## Reading the results

- **Pipeline order:** transformers run sorted by `order` (site config) / `defaultOrder` (manifest), but per
  *stage*: all `textTransform`, then all `markdownPlugins`, then all `htmlPlugins`
  (`docs/ARCHITECTURE.md` §1). A consumer must come after its producer **within the same stage**.
- **Cross-plugin coupling is often implicit** — through DOM classes and scripts, not imports or manifests.
  Example: `just catalog dom clipboard-button` shows syntax-highlighting renders it and
  obsidian-flavored-markdown's mermaid script uses it; with syntax-highlighting disabled, mermaid crashes
  (`e2e/repros/ofm-mermaid-needs-clipboard`). Check `dom` for every class your change touches.
- **Trace anomalies need judgment:** "read but never produced" can mean (a) the producer plugin is disabled
  in that config, (b) no content triggers it (e.g. no page has `aliases`), or (c) a real bug. Cross-check
  with `who-writes`: if a producer exists and is enabled, it's (b) or (c) — add content that should trigger it.
- Static analysis is heuristic: dynamic keys (`file.data[k]`) and data passed through helper functions can
  be missed. Confirm important conclusions in the source (`file:line` is given) or with a trace.

## Before changing a data contract

1. `just catalog who-reads <key>` — list every consumer (Quartz core is included as `quartz (core)`).
2. Change producer + all consumers bottom-up; DataMap types live in the producer's `declare module "vfile"`.
3. `just catalog impact <producer>` → run the suggested commands; `just trace fixture:bug-repro` to confirm at runtime.
4. Treat it as breaking for releases (`release-plugins` skill) if third-party plugins could read the key.
