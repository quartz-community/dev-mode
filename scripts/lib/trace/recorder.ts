/**
 * Pure recording core of the runtime tracer.
 *
 * This file is copied verbatim into a trace sandbox (quartz/plugins/_trace/)
 * next to runtime.ts, so it must not import anything (no node:, no workspace
 * modules). It is also unit-tested directly from tests/trace*.test.ts.
 */

export type ActorKind =
  "transformer" | "filter" | "emitter" | "pageType" | "component" | "core";

export interface Actor {
  /** Stable id, e.g. "transformer:CrawlLinks". */
  id: string;
  kind: ActorKind;
  name: string;
}

export interface StepStats {
  calls: number;
  timeMs: number;
}

export interface ActorStats {
  id: string;
  kind: ActorKind;
  name: string;
  /** Global sequence number of the first time this actor ran (execution order). */
  firstSeq: number;
  calls: number;
  timeMs: number;
  /** Distinct files this actor ran on (transformers / filters). */
  files: number;
  /** key -> number of reads (including `in` checks). */
  reads: Record<string, number>;
  /** key -> number of reads where the key was absent at read time. */
  misses: Record<string, number>;
  /** key -> number of top-level assignments. */
  writes: Record<string, number>;
  /**
   * Whole-object enumerations (spread, Object.keys, JSON.stringify). Property
   * reads performed as part of an enumeration are *not* counted in `reads`.
   */
  enumerations: number;
  /** Per unified-plugin sub-step timing (transformers only). */
  steps: Record<string, StepStats>;
  errors: string[];
  /** Files written (emitters only). */
  emitted: string[];
  /** Slugs dropped (filters only). */
  dropped: string[];
}

export interface PairCount {
  key: string;
  /** Reader (readBeforeWrite) or previous writer (overwrites). */
  from: string;
  /** Writer. */
  to: string;
  files: number;
}

export interface RawTrace {
  version: 1;
  generatedAt: string;
  actors: ActorStats[];
  /** key -> number of files on which it was already present when tracing began (written by core). */
  seededKeys: Record<string, Record<string, number>>;
  /** A plugin read key K on a file while K was absent, and a *different* actor later wrote K on that file. */
  readBeforeWrite: PairCount[];
  /** Actor `to` overwrote key K on a file where `from` had already written it. */
  overwrites: PairCount[];
  /** pageType name -> slugs it rendered. */
  pageTypes: Record<string, string[]>;
  /** pageType name -> component name -> distinct pages rendered on. */
  components: Record<string, Record<string, number>>;
  warnings: string[];
}

export interface FileState {
  id: number;
  slug: string | undefined;
  missedBy: Map<string, Set<string>>;
  lastWriter: Map<string, string>;
}

function bump(record: Record<string, number>, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

export class Recorder {
  private seq = 0;
  private nextFileId = 0;
  private actors = new Map<string, ActorStats>();
  private actorFiles = new Map<string, Set<number>>();
  private seeded: Record<string, Record<string, number>> = {};
  private rbw = new Map<string, PairCount>();
  private overwrite = new Map<string, PairCount>();
  private pageTypeBySlug = new Map<string, string>();
  private componentPages = new Map<string, Map<string, Set<string>>>();
  readonly warnings: string[] = [];

  stats(actor: Actor): ActorStats {
    let stats = this.actors.get(actor.id);
    if (!stats) {
      stats = {
        id: actor.id,
        kind: actor.kind,
        name: actor.name,
        firstSeq: Number.MAX_SAFE_INTEGER,
        calls: 0,
        timeMs: 0,
        files: 0,
        reads: {},
        misses: {},
        writes: {},
        enumerations: 0,
        steps: {},
        errors: [],
        emitted: [],
        dropped: [],
      };
      this.actors.set(actor.id, stats);
    }
    return stats;
  }

  newFile(slug: string | undefined): FileState {
    return {
      id: this.nextFileId++,
      slug,
      missedBy: new Map(),
      lastWriter: new Map(),
    };
  }

  /** Keys present before tracing started on this file are attributed to `producer`. */
  seed(state: FileState, keys: string[], producer: Actor): void {
    for (const key of keys) {
      state.lastWriter.set(key, producer.id);
      this.seeded[key] ??= {};
      bump(this.seeded[key], producer.id);
    }
  }

  /** Mark that `actor` started executing (records execution order). */
  touch(actor: Actor): ActorStats {
    const stats = this.stats(actor);
    if (stats.firstSeq === Number.MAX_SAFE_INTEGER) stats.firstSeq = this.seq++;
    return stats;
  }

  read(state: FileState, key: string, actor: Actor, present: boolean): void {
    const stats = this.stats(actor);
    bump(stats.reads, key);
    if (!present) {
      bump(stats.misses, key);
      let readers = state.missedBy.get(key);
      if (!readers) state.missedBy.set(key, (readers = new Set()));
      readers.add(actor.id);
    }
  }

  enumerate(actor: Actor): void {
    this.stats(actor).enumerations++;
  }

  write(state: FileState, key: string, actor: Actor): void {
    const stats = this.stats(actor);
    bump(stats.writes, key);
    const prev = state.lastWriter.get(key);
    if (prev !== undefined && prev !== actor.id) {
      this.pair(this.overwrite, key, prev, actor.id);
    }
    state.lastWriter.set(key, actor.id);
    const readers = state.missedBy.get(key);
    if (readers) {
      for (const reader of readers) {
        if (reader !== actor.id) this.pair(this.rbw, key, reader, actor.id);
      }
      state.missedBy.delete(key);
    }
  }

  private pair(
    map: Map<string, PairCount>,
    key: string,
    from: string,
    to: string,
  ): void {
    const id = `${key}\u0000${from}\u0000${to}`;
    const existing = map.get(id);
    if (existing) existing.files++;
    else map.set(id, { key, from, to, files: 1 });
  }

  call(actor: Actor, ms: number, file?: FileState, step?: string): void {
    const stats = this.touch(actor);
    stats.calls++;
    stats.timeMs += ms;
    if (file) {
      let files = this.actorFiles.get(actor.id);
      if (!files) this.actorFiles.set(actor.id, (files = new Set()));
      files.add(file.id);
      stats.files = files.size;
    }
    if (step) {
      const s = (stats.steps[step] ??= { calls: 0, timeMs: 0 });
      s.calls++;
      s.timeMs += ms;
    }
  }

  error(actor: Actor, err: unknown): void {
    const stats = this.stats(actor);
    const message = err instanceof Error ? err.message : String(err);
    if (stats.errors.length < 20) stats.errors.push(message.split("\n")[0]!);
  }

  emitted(actor: Actor, path: string): void {
    this.stats(actor).emitted.push(path);
  }

  dropped(actor: Actor, slug: string | undefined): void {
    this.stats(actor).dropped.push(slug ?? "(unknown)");
  }

  /** First matching page type wins (mirrors the dispatcher's `break`). */
  assignPageType(slug: string, pageType: string): void {
    if (!this.pageTypeBySlug.has(slug)) this.pageTypeBySlug.set(slug, pageType);
  }

  pageTypeOf(slug: string | undefined): string {
    return (slug && this.pageTypeBySlug.get(slug)) || "(unknown)";
  }

  rendered(component: string, slug: string | undefined): void {
    const pageType = this.pageTypeOf(slug);
    let byComponent = this.componentPages.get(pageType);
    if (!byComponent)
      this.componentPages.set(pageType, (byComponent = new Map()));
    let pages = byComponent.get(component);
    if (!pages) byComponent.set(component, (pages = new Set()));
    pages.add(slug ?? "(unknown)");
  }

  toJSON(): RawTrace {
    const pageTypes: Record<string, string[]> = {};
    for (const [slug, pt] of this.pageTypeBySlug)
      (pageTypes[pt] ??= []).push(slug);
    const components: Record<string, Record<string, number>> = {};
    for (const [pt, byComponent] of this.componentPages) {
      components[pt] = {};
      for (const [name, pages] of byComponent)
        components[pt][name] = pages.size;
    }
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      actors: [...this.actors.values()].sort((a, b) => a.firstSeq - b.firstSeq),
      seededKeys: this.seeded,
      readBeforeWrite: [...this.rbw.values()],
      overwrites: [...this.overwrite.values()],
      pageTypes,
      components,
      warnings: this.warnings,
    };
  }
}
