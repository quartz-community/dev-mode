---
title: "OxHugoFlavouredMarkdown regexes are greedy and rewrite code blocks"
issue: "quartz-community/ox-hugo#7"
plugins: [ox-hugo]
status: reproduced # fixed on an unmerged plugin branch (see Notes); set to fixed once released
---

# OxHugoFlavouredMarkdown regexes are greedy and rewrite code blocks (quartz-community/ox-hugo#7)

## Problem

`textTransform` ran greedy, unanchored regexes over the whole source: two shortcodes on a line merged,
`{{ … }}` / `{#…}` inside fenced and inline code were rewritten, any line with ` {#…}` was cut, and the
text between two dollar amounts was treated as math (`\_` unescaped).

## Expected

Code untouched, `< kbd A > and < kbd B >`, `$5 … \_x\_ … $10` left as text; heading anchors still
stripped and org math (`\\(…\\)`) still rendered by KaTeX.

## Notes

Fix (ox-hugo branch `dev-mode/anchored-regexes`): code blocks/spans are swapped for placeholders while
the rewrites run; lazy shortcode regex; heading-id regex anchored to ATX headings; inline `$…$` uses
pandoc's rule (no space after the opening / before the closing `$`, no digit after it); figure regex
takes `src="…"` only. Math unescaping now inverts ox-hugo's `org-blackfriday-escape-chars-in-equation`
completely (`\_ \* \``, `\\<punct>`→`\<punct>`, `\]\(`), which covers ox-hugo PR #2's cases
(`\*`, `\{`, `\}`, `\[`) plus `\,`, `\|`, `\\`.
