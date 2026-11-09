---
title: Home
---

Everything in `boards`:

```base
filters:
  and:
    - file.inFolder("boards")
views:
  - type: table
    name: Boards
    order:
      - file.name
      - file.path
      - file.ext
      - file.folder
```

Canvas files only:

```base
filters:
  and:
    - file.ext == "canvas"
views:
  - type: table
    name: Canvases
    order:
      - file.name
      - file.path
```
