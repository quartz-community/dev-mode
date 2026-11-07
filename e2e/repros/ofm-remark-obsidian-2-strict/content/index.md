---
title: Obsidian syntax
tags: [syntax-check]
---

> [!tip] Callout title with **bold**
> Callout body.
> > [!warning]- Folded inner
> > Inner body.

> [!example|wide]+ Metadata and fold

First line
second line of the same paragraph.

Visible %%hidden comment%% text.

%%
block comment
%%

A reference to nothing[^missing] and an inline footnote^[inline note].

==highlighted== and #inline-tag and [[target|a wikilink]].

| a | b |
| - | - |
| 1 | 2 |

Math $x^2$ and

$$
y = mx + b
$$

```
> [!info] Not a callout
> code
```
