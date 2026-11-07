# Known Limitations

## Layout System

### Flex Groups in the Footer

Flex groups (`layout.group` / `layout.groups`) work in the `header`, `beforeBody`, `afterBody`, `left` and `right` slots (header support is covered by `e2e/repros/core-layout-header-group`). The `footer` slot is still unsupported: frames render footer components as direct children of the `#quartz-body` grid, and only a `<footer>` element is assigned `grid-area: grid-footer`. A group's wrapper `<div class="flex-component">` is auto-placed by the grid instead (on desktop it lands in the center column), so footer layout depends on viewport. Lifting this needs a footer container in the frames (a DOM change for custom CSS/frames) or a grid rule for non-`<footer>` children.

### Multiple Footer Components

All built-in frames correctly render multiple footer components. However, if multiple components each render their own `<footer>` HTML element, they will each receive `grid-area: grid-footer` in the CSS grid, causing them to overlap visually. Components that render something other than `<footer>` are auto-placed by the grid (same root cause as above). To avoid this, ensure only one component uses the `<footer>` element, or consolidate multiple footer sections into a single plugin component.

### Mobile Left Sidebar Is a Single Row

Below the `mobile` breakpoint the left sidebar is one non-wrapping horizontal row (`base.scss`, `.sidebar.left`), designed for compact components (page title, search, darkmode, explorer menu button). Tall components placed in `left` (recent notes, graph, TOC) are squeezed into that row. Workaround: `display: desktop-only` or another slot (documented in `docs/layout.md` → "Mobile layout"; the bug-repro fixture does this for recent-notes). A core fix (e.g. `flex-wrap: wrap` with full-width rows for non-toolbar components) would change the mobile look of existing sites, so it was not made.

### `byPageType.positions` Only Clears Slots

`layout.byPageType.<type>.positions.<slot>` only accepts `[]` (clear the slot). Non-empty lists are ignored with a build warning. Moving a component to a different slot on a single page type requires `exclude` plus a TS override in `quartz.ts`.

### Unknown Conditions Render the Component

A `layout.condition` that names no registered condition prints a build warning and the component is always rendered (fail-open). Failing closed would hide components on typos; left as-is for compatibility.

### Head Component

The `head` slot remains hardcoded and is not configurable through the layout position system. It renders inside the HTML `<head>` tag and is responsible for metadata, scripts, and styles rather than visual page content.
