---
title: "Explorer: remembered folder state, row clicks, aria-expanded"
issue: ""
plugins: [explorer]
status: fixed # open | reproduced | fixed | wontfix
---

# Explorer folder state and toggles

## Notes

`explorer.inline.ts` (explorer 1.2.2) with `folderClickBehavior: collapse`:

- `toggleFolder` saves each folder's state in `localStorage.fileTree`: a folder opened on one
  page stays open after an SPA navigation to a page outside it and after a reload; closed
  again, it stays closed after a reload. `is-collapsed` (Obsidian's class) follows on the `li`.
- A click on the folder row outside the title toggles it (Obsidian toggles on the whole row);
  a ctrl-click does not.
- `aria-expanded` follows the desktop and the mobile toggle (and `mobile-no-scroll` the
  mobile menu).

`folderDefaultState` and `useSavedState` are `explorer-default-state-options`; Obsidian's
`data-path` is `explorer-folder-data-path`.
