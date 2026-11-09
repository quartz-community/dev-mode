// Runs INSIDE Obsidian's renderer (evaluated as text by probe.ts, so no bundler
// helpers leak in). Installs `window.__probe` with serializers for Bases views.
// `window.__probeObsidian` is the `obsidian` module, exposed by the helper plugin.
(() => {
  const o = window.__probeObsidian;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Most specific first: RelativeDateValue extends DateValue, etc.
  const VALUE_CLASSES = [
    "RelativeDateValue",
    "DateValue",
    "DurationValue",
    "ImageValue",
    "UrlValue",
    "LinkValue",
    "FileValue",
    "TagValue",
    "HTMLValue",
    "IconValue",
    "RegExpValue",
    "ListValue",
    "ObjectValue",
    "BooleanValue",
    "NumberValue",
    "StringValue",
    "NullValue",
    "PrimitiveValue",
    "NotNullValue",
    "Value",
  ];

  function valueType(v) {
    if (!o) return v?.constructor?.name ?? typeof v;
    for (const name of VALUE_CLASSES) {
      if (o[name] && v instanceof o[name]) return name;
    }
    return v === null || v === undefined ? String(v) : typeof v;
  }

  function plain(x, depth = 0) {
    if (x === null || x === undefined) return x;
    if (typeof x === "function") return undefined;
    if (typeof x !== "object") return x;
    if (x instanceof Date) return { $date: x.toISOString(), local: String(x) };
    if (x instanceof RegExp) return { $regexp: String(x) };
    if (window.moment && window.moment.isMoment(x))
      return { $moment: x.format() };
    if (o && x instanceof o.TFile) return { $file: x.path };
    if (o && x instanceof o.Value) return serializeValue(x, depth + 1);
    if (depth > 4) return "[deep]";
    if (Array.isArray(x)) return x.map((y) => plain(y, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(x)) {
      if (k === "app" || k === "icon" || k === "ctx") continue;
      const p = plain(v, depth + 1);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }

  function renderValue(v) {
    const div = document.createElement("div");
    try {
      v.renderTo(div, new o.RenderContext(app));
    } catch (e) {
      return { error: String(e) };
    }
    return { html: cleanHtml(div), text: div.textContent };
  }

  function serializeValue(v, depth = 0) {
    if (v === null || v === undefined) return { type: String(v) };
    if (typeof v !== "object") return { type: typeof v, js: v };
    const out = { type: valueType(v) };
    try {
      out.str = v.toString();
    } catch (e) {
      out.strError = String(e);
    }
    try {
      out.truthy = v.isTruthy();
    } catch {
      /* not every value has it */
    }
    if (typeof v.getMilliseconds === "function") {
      try {
        out.getMilliseconds = v.getMilliseconds();
      } catch (e) {
        out.getMillisecondsError = String(e);
      }
    }
    if (depth < 4)
      out.fields = plain(Object.fromEntries(Object.entries(v)), depth + 1);
    if (depth === 0) out.rendered = renderValue(v);
    return out;
  }

  function cleanHtml(el) {
    const clone = el.cloneNode(true);
    // Inputs carry their value as a property, not an attribute: surface it.
    const src = el.querySelectorAll("input, textarea, select");
    const dst = clone.querySelectorAll("input, textarea, select");
    src.forEach((s, i) => {
      if (!dst[i]) return;
      if (s.type === "checkbox")
        dst[i].setAttribute("data-probe-checked", String(s.checked));
      else if (s.value !== "") dst[i].setAttribute("data-probe-value", s.value);
    });
    clone
      .querySelectorAll("svg")
      .forEach((s) => s.replaceWith(document.createComment("svg")));
    return clone.outerHTML ?? clone.innerHTML;
  }

  function cellText(el) {
    const inputs = [...el.querySelectorAll("input, textarea")].map((i) =>
      i.type === "checkbox" ? (i.checked ? "[x]" : "[ ]") : i.value,
    );
    const text = el.textContent.trim();
    return inputs.length && !text
      ? inputs.join(" | ")
      : inputs.length
        ? `${text} [${inputs.join(" | ")}]`
        : text;
  }

  function rect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function computed(el, props) {
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  }

  /** Displayed contents of one `.bases-view` element (table / cards / list / other). */
  function readViewDom(viewEl) {
    const type = viewEl.getAttribute("data-view-type");
    const out = {
      type,
      name: viewEl.getAttribute("data-view-name"),
      rect: rect(viewEl),
    };
    if (type === "table") {
      out.headers = [...viewEl.querySelectorAll(".bases-thead .bases-td")].map(
        (td) => ({
          label: td.textContent.trim(),
          className: td.className,
        }),
      );
      out.rows = [...viewEl.querySelectorAll(".bases-tbody .bases-tr")].map(
        (tr) =>
          [...tr.querySelectorAll(".bases-td")].map((td) => ({
            property: td.getAttribute("data-property"),
            propertyType:
              td
                .querySelector("[data-property-type]")
                ?.getAttribute("data-property-type") ?? null,
            text: cellText(td),
          })),
      );
      out.groups = [
        ...viewEl.querySelectorAll(".bases-group-heading, .bases-group-value"),
      ].map((g) => g.textContent.trim());
    } else if (type === "cards") {
      // The first group is an invisible measuring template (opacity: 0): skip it.
      const cardEls = [...viewEl.querySelectorAll(".bases-cards-item")].filter(
        (card) =>
          getComputedStyle(card.closest(".bases-cards-group") ?? card)
            .opacity !== "0",
      );
      out.cards = cardEls.map((card) => {
        const cover = card.querySelector(".bases-cards-cover");
        const img = cover?.querySelector("img") ?? null;
        return {
          rect: rect(card),
          className: card.className,
          tag: card.tagName,
          cover: cover
            ? {
                rect: rect(cover),
                style: cover.getAttribute("style"),
                css: computed(cover, [
                  "aspect-ratio",
                  "background-size",
                  "background-image",
                  "border-radius",
                  "margin",
                  "padding",
                  "height",
                  "width",
                ]),
                img: img
                  ? {
                      src: img.getAttribute("src"),
                      rect: rect(img),
                      css: computed(img, [
                        "object-fit",
                        "width",
                        "height",
                        "aspect-ratio",
                      ]),
                    }
                  : null,
              }
            : null,
          css: computed(card, [
            "border-radius",
            "margin",
            "padding",
            "box-shadow",
            "border",
            "overflow",
          ]),
          properties: [...card.querySelectorAll(".bases-cards-property")].map(
            (p) => ({
              property: p.getAttribute("data-property"),
              label:
                p.querySelector(".bases-cards-label")?.textContent.trim() ??
                null,
              text: cellText(p.querySelector(".bases-cards-line") ?? p),
            }),
          ),
          links: [
            ...card.querySelectorAll("a, .internal-link, [data-href]"),
          ].map((a) => ({
            tag: a.tagName,
            className: a.className,
            href: a.getAttribute("href"),
            dataHref: a.getAttribute("data-href"),
            text: a.textContent.trim(),
          })),
          html: cleanHtml(card),
        };
      });
      out.containerCss = (() => {
        const grid =
          viewEl.querySelector(".bases-cards-container, .bases-cards-group") ??
          viewEl;
        return computed(grid, [
          "display",
          "grid-template-columns",
          "gap",
          "--bases-cards-container-width",
          "--bases-cards-cover-ratio",
        ]);
      })();
    } else {
      out.items = [
        ...viewEl.querySelectorAll("li, .bases-list-item, [class*='-item']"),
      ]
        .slice(0, 200)
        .map((li) => ({
          className: li.className,
          text: cellText(li),
        }));
    }
    out.text = viewEl.innerText.slice(0, 20000);
    out.html = cleanHtml(viewEl).slice(0, 200000);
    return out;
  }

  /** Evaluated values: every result entry x every property the view shows (plus `extra`). */
  function readController(c, extra = []) {
    const out = {
      viewName: c.viewName ?? null,
      views: (c.query?.views ?? []).map((v) => ({
        name: v.name,
        type: v.type,
      })),
      currentFile: c.currentFile?.path ?? c.getCurrentFile?.()?.path ?? null,
      errors: plain(c.errors ?? null),
      error: c.error ? String(c.error?.message ?? c.error) : null,
      errorText: c.errorEl?.textContent?.trim() || null,
    };
    let order = [];
    try {
      const cfg = c.getViewConfig?.() ?? null;
      order = cfg?.order ?? cfg?.get?.("order") ?? [];
      const raw = cfg?.data ?? cfg ?? {};
      out.viewConfig = plain(
        Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "query")),
      );
    } catch (e) {
      out.viewConfigError = String(e);
    }
    if (!Array.isArray(order) || order.length === 0) order = ["file.name"];
    const props = [...new Set([...order, ...extra])];
    out.properties = props;
    out.entries = [...(c.results?.values() ?? [])].map((e) => {
      const values = {};
      for (const p of props) {
        try {
          values[p] = serializeValue(e.getValue(p));
        } catch (err) {
          values[p] = { error: String(err?.message ?? err) };
        }
      }
      return { file: e.file?.path, values };
    });
    out.entries.sort((a, b) => String(a.file).localeCompare(String(b.file)));
    return out;
  }

  /** Every Bases controller reachable from a leaf: the .base view's own, or those of embeds. */
  function findControllers(leaf) {
    const found = [];
    const seen = new Set();
    const visit = (comp, depth) => {
      if (!comp || typeof comp !== "object" || seen.has(comp) || depth > 30)
        return;
      seen.add(comp);
      if (o && comp instanceof o.QueryController) found.push(comp);
      for (const child of comp._children ?? []) visit(child, depth + 1);
      for (const key of [
        "controller",
        "embed",
        "previewMode",
        "currentMode",
        "renderer",
        "child",
      ]) {
        if (comp[key] && typeof comp[key] === "object")
          visit(comp[key], depth + 1);
      }
      if (Array.isArray(comp.sections))
        for (const s of comp.sections) visit(s?.child ?? s, depth + 1);
    };
    visit(leaf.view, 0);
    // Reading view and live preview both keep a rendered copy; report the visible one.
    return found.filter((c) => {
      const el = c.viewContainerEl ?? c.containerEl;
      return !el || (el.isConnected && el.offsetParent !== null);
    });
  }

  async function waitForRender(root, ms) {
    const until = Date.now() + ms;
    let last = "";
    let stable = 0;
    while (Date.now() < until) {
      await sleep(200);
      const views = root.querySelectorAll(".bases-view");
      const now =
        views.length +
        ":" +
        [...views].map((v) => v.innerHTML.length).join(",");
      if (views.length > 0 && now === last) {
        if (++stable >= 3) return true;
      } else stable = 0;
      last = now;
    }
    return false;
  }

  /**
   * Evaluate formulas ad hoc: writes `__adhoc.base` (filter + one table view of the formulas),
   * opens it in the probe leaf and returns, per formula, value/str/rendered for each entry.
   *   __probe.adhoc({ d: 'date("2024-03-10") - date("2024-03-01")' }, 'file.name == "probe"')
   */
  async function adhoc(formulas, filter = 'file.ext == "md"', wait = 8000) {
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const keys = Object.keys(formulas);
    const yaml = [
      "filters:",
      "  and:",
      `    - ${q(filter)}`,
      "formulas:",
      ...keys.map((k) => `  ${k}: ${q(formulas[k])}`),
      "views:",
      "  - type: table",
      "    name: adhoc",
      "    order:",
      "      - file.name",
      ...keys.map((k) => `      - formula.${k}`),
      "",
    ].join("\n");
    const path = "__adhoc.base";
    let file = app.vault.getAbstractFileByPath(path);
    if (file) await app.vault.modify(file, yaml);
    else file = await app.vault.create(path, yaml);
    const leaf = window.__probeLeaf ?? app.workspace.getLeaf(false);
    window.__probeLeaf = leaf;
    if (leaf.view?.file?.path !== path) await leaf.openFile(file);
    await sleep(600);
    await waitForRender(leaf.view.containerEl, wait);
    const c = leaf.view.controller;
    const out = {};
    for (const e of c.results.values()) {
      if (e.file.path === path) continue;
      out[e.file.path] = Object.fromEntries(
        keys.map((k) => {
          try {
            const v = serializeValue(e.getValue("formula." + k));
            return [
              k,
              {
                type: v.type,
                str: v.str,
                rendered: v.rendered?.text,
                fields: v.fields,
              },
            ];
          } catch (err) {
            return [k, { error: String(err?.message ?? err) }];
          }
        }),
      );
    }
    return out;
  }

  window.__probe = {
    adhoc,
    serializeValue,
    readViewDom,
    readController,
    findControllers,
    cleanHtml,
    waitForRender,
    sleep,
    plain,
    rect,
    computed,
  };
  return true;
})();
