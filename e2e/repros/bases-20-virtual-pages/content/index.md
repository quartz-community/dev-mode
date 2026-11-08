---
title: Home
tags: [demo]
---

Notes in the content root:

```base
filters:
  and:
    - file.path != this.file.path
    - file.folder == this.file.folder
views:
  - type: table
    name: Notes
```

Every other note:

```base
filters:
  and:
    - file.path != this.file.path
views:
  - type: table
    name: All
```
