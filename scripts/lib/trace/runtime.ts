/**
 * Runtime instrumentation injected into a *trace sandbox* copy of Quartz
 * (copied to quartz/plugins/_trace/runtime.ts by scripts/lib/trace/patches.ts).
 * Never imported by workspace scripts directly; it only runs inside a Quartz build.
 *
 * Attribution model:
 *  - AsyncLocalStorage holds the "current actor" (transformer / filter / emitter /
 *    page type). Unified transformers, emitter generators and filters run inside
 *    `als.run(actor, ...)`, so async continuations stay attributed.
 *  - Preact component renders are synchronous, so a plain stack driven by the
 *    preact `options.__b` (diff) / `options.diffed` hooks overrides the ALS actor
 *    while a Quartz component (props carry `fileData` + `cfg`) renders.
 *  - Every vfile's `file.data` is replaced by a recording Proxy the first time a
 *    traced actor sees it; get/has record reads, set/defineProperty/delete record writes.
 *
 * Inert unless QUARTZ_TRACE_OUT is set.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { options } from "preact";
import { Recorder, type Actor, type FileState } from "./recorder.js";

const OUT = process.env.QUARTZ_TRACE_OUT;
const als = new AsyncLocalStorage<Actor>();
const recorder = new Recorder();
const componentStack: Array<{ actor: Actor; vnode: unknown }> = [];
const proxyStates = new WeakMap<object, FileState>();
const actorCache = new Map<string, Actor>();
const PROXIED = Symbol.for("quartz.trace.proxied");
/** Property names probed by JS machinery rather than plugins. */
const IGNORED_KEYS = new Set([
  "then",
  "toJSON",
  "constructor",
  "__proto__",
  "valueOf",
  "toString",
  "$$typeof",
  "nodeType",
  "asymmetricMatch",
]);

const CORE: Actor = { id: "core", kind: "core", name: "(core)" };
const CORE_PARSE: Actor = {
  id: "core:parse",
  kind: "core",
  name: "(core) parse.ts base data",
};
const CORE_VIRTUAL: Actor = {
  id: "core:virtual-page",
  kind: "core",
  name: "(core) virtual page data",
};

let flushed = false;
let instrumented = false;

function actor(kind: Actor["kind"], name: string): Actor {
  const id = `${kind}:${name}`;
  let a = actorCache.get(id);
  if (!a) actorCache.set(id, (a = { id, kind, name }));
  return a;
}

function current(): Actor {
  const top = componentStack[componentStack.length - 1];
  return top ? top.actor : (als.getStore() ?? CORE);
}

/** Wrap a vfile data object in a recording proxy (idempotent). */
export function proxyData<T>(data: T, producer: Actor = CORE_PARSE): T {
  if (!OUT || !data || typeof data !== "object" || (data as any)[PROXIED])
    return data;
  const target = data as Record<string, unknown>;
  const state = recorder.newFile(
    typeof target.slug === "string" ? target.slug : undefined,
  );
  recorder.seed(state, Object.keys(target), producer);
  // Keys probed by an in-flight enumeration (spread / Object.keys / JSON.stringify
  // call ownKeys, then getOwnPropertyDescriptor + get per key, synchronously).
  // Those gets are bulk copies, not semantic reads; the set is cleared on the next microtask.
  let enumerating: Set<string> | undefined;
  const proxy = new Proxy(target, {
    ownKeys(t) {
      recorder.enumerate(current());
      if (!enumerating) {
        enumerating = new Set();
        queueMicrotask(() => (enumerating = undefined));
      }
      const keys = Reflect.ownKeys(t);
      for (const k of keys) if (typeof k === "string") enumerating.add(k);
      return keys;
    },
    getOwnPropertyDescriptor(t, key) {
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
    get(t, key) {
      if (key === PROXIED) return true;
      if (typeof key === "string" && enumerating?.delete(key))
        return Reflect.get(t, key);
      if (typeof key === "string" && !IGNORED_KEYS.has(key)) {
        recorder.read(state, key, current(), key in t);
      }
      return Reflect.get(t, key);
    },
    has(t, key) {
      if (key === PROXIED) return true;
      if (typeof key === "string" && !IGNORED_KEYS.has(key)) {
        recorder.read(state, key, current(), key in t);
      }
      return Reflect.has(t, key);
    },
    set(t, key, value) {
      if (typeof key === "string") {
        recorder.write(state, key, current());
        if (key === "slug" && typeof value === "string") state.slug = value;
      }
      // No receiver: avoids a second trip through defineProperty.
      return Reflect.set(t, key, value);
    },
    defineProperty(t, key, desc) {
      if (typeof key === "string") recorder.write(state, key, current());
      return Reflect.defineProperty(t, key, desc);
    },
    deleteProperty(t, key) {
      if (typeof key === "string") recorder.write(state, key, current());
      return Reflect.deleteProperty(t, key);
    },
  });
  proxyStates.set(proxy, state);
  return proxy as T;
}

/** Used by the patched defaultProcessedContent() for virtual pages. */
export function wrapVirtualData<T>(data: T): T {
  return proxyData(data, CORE_VIRTUAL);
}

function ensureProxied(file: any): FileState | undefined {
  if (!file || typeof file !== "object" || !file.data) return undefined;
  if (!file.data[PROXIED]) file.data = proxyData(file.data, CORE_PARSE);
  return proxyStates.get(file.data);
}

function isThenable(value: any): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.then === "function"
  );
}

// ---------------------------------------------------------------------------
// Transformers (unified attachers -> transformer functions)
// ---------------------------------------------------------------------------

function wrapTransformer(fn: any, who: Actor, step: string): any {
  const finish = (start: number, file: FileState | undefined) =>
    recorder.call(who, performance.now() - start, file, step);
  if (fn.length >= 3) {
    // Callback-style transformer: (tree, file, next). Arity must be preserved —
    // trough decides callback vs. promise style from `fn.length`.
    return function (
      this: unknown,
      tree: unknown,
      file: any,
      next: (...args: unknown[]) => void,
    ) {
      const state = ensureProxied(file);
      recorder.touch(who);
      const start = performance.now();
      return als.run(who, () =>
        fn.call(this, tree, file, (err: unknown, ...rest: unknown[]) => {
          finish(start, state);
          if (err) recorder.error(who, err);
          next(err, ...rest);
        }),
      );
    };
  }
  return function (this: unknown, tree: unknown, file: any) {
    const state = ensureProxied(file);
    recorder.touch(who);
    const start = performance.now();
    let result: any;
    try {
      result = als.run(who, () => fn.call(this, tree, file));
    } catch (err) {
      finish(start, state);
      recorder.error(who, err);
      throw err;
    }
    if (isThenable(result)) {
      return Promise.resolve(result).then(
        (value) => {
          finish(start, state);
          return value;
        },
        (err) => {
          finish(start, state);
          recorder.error(who, err);
          throw err;
        },
      );
    }
    finish(start, state);
    return result;
  };
}

const attacherCache = new WeakMap<object, Map<string, unknown>>();

function wrapAttacher(attacher: any, who: Actor, step: string): any {
  let perActor = attacherCache.get(attacher);
  if (!perActor) attacherCache.set(attacher, (perActor = new Map()));
  const cacheKey = `${who.id}|${step}`;
  const cached = perActor.get(cacheKey);
  if (cached) return cached;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const transformer = attacher.apply(this, args);
    return typeof transformer === "function"
      ? wrapTransformer(transformer, who, step)
      : transformer;
  };
  Object.defineProperty(wrapped, "name", {
    value: attacher.name || "anonymous",
  });
  perActor.set(cacheKey, wrapped);
  return wrapped;
}

function wrapPluggable(p: any, who: Actor, step: string): any {
  if (typeof p === "function")
    return wrapAttacher(p, who, `${step}:${p.name || "anonymous"}`);
  if (Array.isArray(p) && typeof p[0] === "function") {
    return [
      wrapAttacher(p[0], who, `${step}:${p[0].name || "anonymous"}`),
      ...p.slice(1),
    ];
  }
  if (p && typeof p === "object" && Array.isArray(p.plugins)) {
    return {
      ...p,
      plugins: p.plugins.map((q: any, j: number) =>
        wrapPluggable(q, who, `${step}.${j}`),
      ),
    };
  }
  return p;
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

function wrapAsyncIterable(
  iterable: any,
  who: Actor,
  start: number,
): AsyncIterableIterator<unknown> {
  const it = iterable[Symbol.asyncIterator]();
  let done = false;
  const end = () => {
    if (!done) {
      done = true;
      recorder.call(who, performance.now() - start);
    }
  };
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next(...args: [] | [unknown]) {
      return als
        .run(who, () => it.next(...args))
        .then(
          (r: IteratorResult<unknown>) => {
            if (r.done) end();
            else recorder.emitted(who, String(r.value));
            return r;
          },
          (err: unknown) => {
            end();
            recorder.error(who, err);
            throw err;
          },
        );
    },
    return(value?: unknown) {
      end();
      return it.return
        ? it.return(value)
        : Promise.resolve({ done: true, value });
    },
    throw(err?: unknown) {
      end();
      return it.throw ? it.throw(err) : Promise.reject(err);
    },
  } as AsyncIterableIterator<unknown>;
}

function wrapEmitResult(result: any, who: Actor, start: number): any {
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    return wrapAsyncIterable(result, who, start);
  }
  if (isThenable(result)) {
    return Promise.resolve(result).then(
      (value) => wrapEmitResult(value, who, start),
      (err) => {
        recorder.call(who, performance.now() - start);
        recorder.error(who, err);
        throw err;
      },
    );
  }
  recorder.call(who, performance.now() - start);
  if (Array.isArray(result))
    for (const fp of result) recorder.emitted(who, String(fp));
  return result;
}

function wrapEmitFn(fn: any, who: Actor): any {
  return function (this: unknown, ...args: any[]) {
    const content = args[1];
    if (Array.isArray(content))
      for (const item of content) ensureProxied(item?.[1]);
    recorder.touch(who);
    const start = performance.now();
    let result: any;
    try {
      result = als.run(who, () => fn.apply(this, args));
    } catch (err) {
      recorder.call(who, performance.now() - start);
      recorder.error(who, err);
      throw err;
    }
    return wrapEmitResult(result, who, start);
  };
}

// ---------------------------------------------------------------------------
// Components (preact render hooks)
// ---------------------------------------------------------------------------

function installComponentHooks(): void {
  const opts = options as any;
  const prevDiff = opts.__b;
  const prevDiffed = opts.diffed;
  opts.__b = (vnode: any) => {
    const type = vnode?.type;
    const props = vnode?.props;
    if (
      typeof type === "function" &&
      props &&
      typeof props === "object" &&
      "fileData" in props &&
      "cfg" in props
    ) {
      const name = String(type.displayName || type.name || "anonymous");
      const who = actor("component", name);
      recorder.touch(who);
      const state = proxyStates.get(props.fileData);
      recorder.rendered(name, state?.slug);
      componentStack.push({ actor: who, vnode });
    }
    if (prevDiff) prevDiff(vnode);
  };
  opts.diffed = (vnode: any) => {
    if (prevDiffed) prevDiffed(vnode);
    const idx = componentStack.findLastIndex((entry) => entry.vnode === vnode);
    if (idx >= 0) componentStack.length = idx;
  };
}

// ---------------------------------------------------------------------------
// Config instrumentation entry point
// ---------------------------------------------------------------------------

function replaceMethod(
  obj: any,
  key: string,
  make: (orig: any) => any,
  label: string,
): void {
  const orig = obj?.[key];
  if (typeof orig !== "function") return;
  const next = make(orig);
  try {
    obj[key] = next;
  } catch {
    // fall through to verification
  }
  if (obj[key] !== next)
    recorder.warnings.push(`could not instrument ${label}.${key} (read-only)`);
}

export function instrumentConfig(cfg: any): void {
  if (!OUT || instrumented) return;
  instrumented = true;
  const plugins = cfg?.plugins ?? {};

  for (const t of plugins.transformers ?? []) {
    const who = actor("transformer", String(t.name));
    replaceMethod(
      t,
      "textTransform",
      (orig) =>
        function (this: unknown, ctx: unknown, src: unknown) {
          recorder.touch(who);
          const start = performance.now();
          try {
            return als.run(who, () => orig.call(this, ctx, src));
          } finally {
            recorder.call(who, performance.now() - start, undefined, "text");
          }
        },
      who.id,
    );
    for (const [key, label] of [
      ["markdownPlugins", "md"],
      ["htmlPlugins", "html"],
    ] as const) {
      replaceMethod(
        t,
        key,
        (orig) =>
          function (this: unknown, ctx: unknown) {
            const list = orig.call(this, ctx);
            return Array.isArray(list)
              ? list.map((p, i) => wrapPluggable(p, who, `${label}#${i}`))
              : list;
          },
        who.id,
      );
    }
  }

  for (const f of plugins.filters ?? []) {
    const who = actor("filter", String(f.name));
    replaceMethod(
      f,
      "shouldPublish",
      (orig) =>
        function (this: unknown, ctx: unknown, content: any) {
          const state = ensureProxied(content?.[1]);
          recorder.touch(who);
          const start = performance.now();
          const keep = als.run(who, () => orig.call(this, ctx, content));
          recorder.call(who, performance.now() - start, state);
          if (!keep) recorder.dropped(who, state?.slug);
          return keep;
        },
      who.id,
    );
  }

  for (const e of plugins.emitters ?? []) {
    const who = actor("emitter", String(e.name));
    replaceMethod(e, "emit", (orig) => wrapEmitFn(orig, who), who.id);
    replaceMethod(e, "partialEmit", (orig) => wrapEmitFn(orig, who), who.id);
  }

  for (const pt of plugins.pageTypes ?? []) {
    const who = actor("pageType", String(pt.name));
    replaceMethod(
      pt,
      "match",
      (orig) =>
        function (this: unknown, args: any) {
          recorder.touch(who);
          const matched = als.run(who, () => orig.call(this, args));
          if (matched && typeof args?.slug === "string")
            recorder.assignPageType(args.slug, String(pt.name));
          return matched;
        },
      who.id,
    );
    replaceMethod(
      pt,
      "generate",
      (orig) =>
        function (this: unknown, args: any) {
          recorder.touch(who);
          const start = performance.now();
          const pages = als.run(who, () => orig.call(this, args));
          recorder.call(who, performance.now() - start);
          if (Array.isArray(pages)) {
            for (const vp of pages) {
              if (typeof vp?.slug === "string")
                recorder.assignPageType(vp.slug, String(pt.name));
            }
          }
          return pages;
        },
      who.id,
    );
  }

  installComponentHooks();
  process.on("exit", () => flushTrace());
}

export function flushTrace(): void {
  if (!OUT || flushed) return;
  flushed = true;
  if (
    !recorder
      .toJSON()
      .actors.some((a) => a.kind === "transformer" && a.calls > 0)
  ) {
    recorder.warnings.push(
      "no transformer executions were recorded — was the build run with worker threads (-c > 1)?",
    );
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(recorder.toJSON(), null, 2));
}
