---
title: "Comments (giscus): client script, SPA navigation, theme changes"
issue: null
plugins: [comments, darkmode]
status: fixed # open | reproduced | fixed | wontfix
---

# Comments (giscus) at runtime

Browser coverage for `comments.inline.ts`, which no other browser test loaded with its options.

## Expected (asserted by repro.spec.ts)

- A page with comments gets one `<script src="https://giscus.app/client.js">` in `.giscus`,
  `async`, `crossorigin="anonymous"`, with every configured option as a data attribute
  (`data-repo`, `-repo-id`, `-category`, `-category-id`, `-mapping`, `-strict`,
  `-reactions-enabled`, `-input-position`, `-lang`, `data-loading="lazy"`,
  `data-emit-metadata="0"`) and `data-theme` = `themeUrl/<lightTheme|darkTheme>.css` for the
  current `saved-theme`. Another `render` event on the same page adds nothing.
- An SPA navigation re-creates giscus for the new page (one script, one iframe, a new
  client.js request); a page with `comments: false` has no container and loads nothing.
- Clicking the darkmode toggle posts `{ giscus: { setConfig: { theme } } }` to the iframe, also
  after an SPA navigation (one message per click, to the new iframe).

## Notes

No network: `helpers/offline.ts` answers every external request locally, and `giscus.app` is
stubbed. The stub `client.js` records its attributes and adds an `iframe.giscus-frame` (as the
real script does); the stub widget page echoes every message it receives back to the parent.
Passes with the released comments 1.0.3.
