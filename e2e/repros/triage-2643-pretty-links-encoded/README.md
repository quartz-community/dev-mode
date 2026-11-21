---
title: "pretty links keep the folder for encoded names"
issue: "jackyzha0/quartz#2643"
plugins: []
status: fixed # open | reproduced | fixed | wontfix
---

# pretty links keep the folder for encoded names (jackyzha0/quartz#2643)

## Notes

The links built-in classed a link `alias` when its text differed from its percent-encoded href, and prettyLinks leaves aliases alone. Fixed by also comparing with the decoded href (patch proposed in the issue).
