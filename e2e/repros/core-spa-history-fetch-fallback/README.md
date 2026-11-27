---
title: "SPA router: Back/Forward, and falling back to a page load when a fetch fails"
issue: null
plugins: [core]
status: fixed # open | reproduced | fixed | wontfix
---

# SPA router: Back/Forward, and failed fetches

Browser coverage for `quartz/components/scripts/spa.inline.ts` paths no other test checked
in full: Back/Forward over several SPA navigations, and what the router does when fetching the
next page fails.

## Expected (asserted by repro.spec.ts)

- Home → Alpha → Beta → Gamma by link, then Back ×3 / Forward ×2: each step shows the right URL,
  `<title>`, article title and body (and none of the other pages' text), with no page load and
  exactly one `nav` event per page shown. A link followed after Back drops the forward entries.
- The router's `fetch()` of `/beta` fails (the browser's own page load of `/beta` works):
  - network error (`route.abort`): the router falls back to `location.assign`, so `/beta` is
    loaded normally (one document request, the window marker is gone), and the router works
    on the new page;
  - 500 with `text/plain`: same fallback (the router only swaps in `text/html`);
  - 500 with an HTML error page: the router swaps in that page as the server sent it (it
    swaps in any `text/html` response, which is how Quartz's 404 page is shown); the old page's
    content does not stay behind the new URL, and Back shows Alpha again.
- control: a working fetch is an SPA navigation (no document request).

## Notes

Passes with Quartz v5 HEAD. Unlike the router, the prefetcher (`prefetch.inline.ts:74`) drops a
non-`ok` response, so a 5xx is fetched a second time by the router on click and then swapped in
(`spa.inline.ts:150-158` checks only the content type). Not treated as a bug: a page load
shows the same error page. `popover.inline.ts:64` logs the failed fetch with `console.error`,
which the spec ignores along with the browser's "Failed to load resource" for `/beta`.
