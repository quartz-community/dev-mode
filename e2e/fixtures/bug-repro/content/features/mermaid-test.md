---
title: Mermaid Test
date: 2025-01-01
---

# Mermaid Test

This page has a Mermaid diagram that should render after SPA navigation (#2490).

```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do Something]
    B -->|No| D[Do Nothing]
    C --> E[End]
    D --> E
```

Link to navigate away and back: [[index|Home]]
