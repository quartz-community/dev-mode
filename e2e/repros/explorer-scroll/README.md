---
title: "Explorer scroll fade, scroll position and page scroll (fit sidebar)"
issue: quartz-community/explorer#16
plugins: [explorer]
status: reproduced # fixed on an unmerged explorer branch (quartz-community/explorer#36–#39); set to fixed once released
---

# Explorer scroll fade, scroll position and page scroll (fit sidebar)

In a one-screen left sidebar the explorer's list scrolls itself. #16: re-rendering replaced the `overflow-end` marker the fade observes and put the tree after it, so `gradient-active` never appeared. PR #15: opening a long page directly, `scrollIntoView` on the active entry also scrolled the page. Expected: marker last, fade while not at the bottom; scroll position kept across SPA navigation; page stays at the top on load.

Run: `just repro-check explorer-scroll`. Fixed on explorer branch `dev-mode/scroll-fixes`.
