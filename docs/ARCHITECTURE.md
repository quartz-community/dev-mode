# How Quartz v5 works (as seen from this workspace)

A map for agents and humans: what runs when, where data lives, and which dev-mode tool
answers which question. Facts here were checked against `repos/quartz/quartz/` — when in
doubt, the source wins (file references given).

## 1. Build pipeline

```
quartz.config.yaml ──► config-loader ──► plugin instances (sorted by order / defaultOrder)
                      (plugins/loader/config-loader.ts)
content/*.md
  │  parse   (processors/parse.ts; worker threads when many files)
  │    1. every transformer.textTransform(src)            — raw string, in order
  │    2. remark-parse → every transformer.markdownPlugins — ONE unified chain, mdast
  │    3. remark-rehype → every transformer.htmlPlugins    — ONE unified chain, hast
  ▼
[ProcessedContent = (hast tree, vfile)]   vfile.data = "file.data" — the inter-plugin data bus
  │  filter  (processors/filter.ts) — every filter.shouldPublish(ctx, content)
  ▼
  │  emit    (processors/emit.ts) — every emitter.emit(ctx, content, resources)
  │    built-ins: ComponentResources, Assets, Static, then plugin emitters,
  │    then PageTypeDispatcher (renders HTML pages via page types + layout)
  ▼
public/
```

Consequences worth remembering:

- **All `markdownPlugins` run before any `htmlPlugins`**, regardless of plugin order. Order only
  matters *within* a stage. A transformer that needs mdast data from another must have a higher
  `order` / `defaultOrder` than it.
- Transformers communicate only through `file.data` (declared via
  `declare module "vfile" { interface DataMap { … } }`). Components and emitters read it later as
  `fileData` / `allFiles`. → `just catalog who-writes <key>` / `who-reads <key>`, `DATA-FLOW.md`.
- Parsing can run in worker threads (`--concurrency`), so transformers must not rely on shared
  mutable module state across files.

## 2. Plugin categories (`package.json` → `"quartz".category`)

| Category | Implements | Runs |
|---|---|---|
| transformer | `textTransform`, `markdownPlugins`, `htmlPlugins`, `externalResources` | parse stage, per file |
| filter | `shouldPublish` | after parse, decides what is emitted |
| emitter | `emit`, `partialEmit` (incremental), `getQuartzComponents` | emit stage, writes files |
| pageType | `match`, `generate` (virtual pages), `layout`, `frame`, `body`, `treeTransforms` | rendered by PageTypeDispatcher |
| component | Preact components with `css`, `beforeDOMLoaded`, `afterDOMLoaded` | at render time, placed in layout slots |

One package may be several categories (array). Types: `repos/quartz/quartz/plugins/types.ts`,
`repos/types/` (the published `@quartz-community/types`).

## 3. Layout and rendering

- Components declare `defaultPosition` / `defaultPriority` in their manifest; sites override per plugin
  with `layout: { position, priority, display, condition, group }` in `quartz.config.yaml`.
- Slots: `head` (fixed), `header`, `beforeBody`, page body, `afterBody`, `left`, `right`, `footer`.
  In the DOM: `.page-header`, `.center`, `article`, `.left.sidebar`, `.right.sidebar`, `footer`.
- Frames (`components/frames/`: default, full-width, minimal) arrange the slots; page types and
  `layout.byPageType` select them. Known limits: `KNOWN_LIMITATIONS.md`.
- Rendered HTML has no per-plugin markers. Map DOM → plugin with `just catalog dom <class>`, or look at
  a live page with `just inspect <target> <page>` (layout map, computed styles, screenshot).

## 4. Browser side

- With `enableSPA`, `spa.inline.ts` intercepts internal links, swaps content, then dispatches `nav`
  (and `prenav` before). Component scripts must (re)initialise on `nav` and clean up via
  `window.addCleanup` — the most common SPA bug class: "works on direct load, broken after navigation".
- Data fetched client-side: `static/contentIndex.json` (search, graph, explorer, recent notes …).
- Theme: `document.documentElement` attribute `saved-theme="light|dark"` (repos/darkmode).

## 5. How dev-mode wires it together

- `repos/*` = independent git repos, linked as a pnpm workspace. `.pnpmfile.cjs` rewrites every
  `@quartz-community/*`, `@quartz-themes/*`, `@jackyzha0/quartz` dependency to `workspace:*`.
- **Quartz loads plugins from their `dist/`** (tsup output). Edit `src/` → `just build-plugin <name>`
  (or `just watch`). Sandbox builds warn when a used plugin's `dist/` is older than `src/`.
- `turbo.json` (generated) orders builds by the workspace dependency graph.

### Sandboxed site builds (`scripts/lib/sandbox.ts`)

Quartz resolves `quartz.config.yaml`, `.quartz/plugins` and `public/` relative to its cwd. Instead of
building inside `repos/quartz` (which clobbers `just serve` and serialises builds), dev-mode copies the
Quartz source tree (~17 MB, no node_modules) to `.dev/sandboxes/<name>/`, symlinks `node_modules`, writes
the resolved config there and builds. Each sandbox is its own git root (Quartz globs with
`gitignore: true`). ~2-5 s per build; fixtures build in parallel.

Config can be a full `quartz.config.yaml` or an **overlay**:

```yaml
extends: default            # default | fixture:<name> | path/to/config.yaml
configuration: { baseUrl: localhost/sub, enableSPA: false }   # deep-merged
only: [obsidian-flavored-markdown, crawl-links, content-page] # enable only these
enable: [graph]
disable: [explorer]
plugins:
  graph: { options: { localGraph: { depth: 2 } }, layout: { position: left } }
```

## 6. Which tool answers which question

| Question | Tool |
|---|---|
| What does plugin X do / provide / consume? | `just catalog show X` · `.dev/catalog/CATALOG.md` |
| Who produces / consumes `file.data.K`? | `just catalog who-writes K` / `who-reads K` · `DATA-FLOW.md` |
| …at runtime, for real, on this site? | `just trace fixture:bug-repro` · `.dev/trace/*/TRACE.md` (prototype) |
| What breaks if I change X? | `just catalog impact X` |
| Which plugin renders `.foo`? | `just catalog dom foo` |
| Does the site build / what warnings? | `just site-build <target>` |
| What does page P look like / any console errors? | `just inspect <target> P --screenshot` |
| Did my CSS change anything else? | `just visual-baseline` → change → `just visual-check` |
| Turn an issue into a failing test | `just repro-new <slug>` → `just repro-check <slug> --expect-fail` |
| What needs releasing, in which order? | `just release-status` · `just release-plan <pkgs>` |

Skills in `.claude/skills/` wrap these into step-by-step workflows.
