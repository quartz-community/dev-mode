Source text.

```base
formulas:
  me: this.file.name
views:
  - type: table
    name: Source inline
    filters:
      and:
        - file.inFolder("Books")
    order: [file.name, formula.me]
```

![[Shelf.base]]
