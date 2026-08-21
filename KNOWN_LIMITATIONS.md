# Known Limitations

## Layout System

### Flex Groups

Header and footer positions do not currently participate in the flex group system. Components in the `header` and `footer` positions cannot use `group` or `groupOptions` in their layout configuration.

### Multiple Footer Components

All built-in frames correctly render multiple footer components. However, if multiple components each render their own `<footer>` HTML element, they will each receive `grid-area: grid-footer` in the CSS grid, causing them to overlap visually. To avoid this, ensure only one component uses the `<footer>` element, or consolidate multiple footer sections into a single plugin component.

### Head Component

The `head` slot remains hardcoded and is not configurable through the layout position system. It renders inside the HTML `<head>` tag and is responsible for metadata, scripts, and styles rather than visual page content.