---
title: Host
---

Host text.

```base
views:
  - type: list
    name: Host list
    filters:
      and:
        - file.inFolder("Books")
    order: [file.name]
```

![[Source]]
