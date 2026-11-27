---
title: "Explorer scroll fade, scroll position and page scroll (fit sidebar)"
issue: quartz-community/explorer#16
plugins: [explorer]
status: fixed # quartz-community/explorer#37 merged 2026-11-26 (explorer 1.2.2 on npm)
---

# Explorer scroll fade, scroll position and page scroll (fit sidebar)

In a one-screen left sidebar the explorer's list scrolls itself. #16: re-rendering replaced the `overflow-end` marker the fade observes and put the tree after it, so `gradient-active` never appeared. PR #15: opening a long page directly, `scrollIntoView` on the active entry also scrolled the page. Expected: marker last, fade while not at the bottom; scroll position kept across SPA navigation; page stays at the top on load.

Run: `just repro-check explorer-scroll`. Fixed on explorer branch `dev-mode/scroll-fixes`.
