/**
 * Source patches that inject the runtime tracer into a *sandbox copy* of Quartz.
 * Never applied to repos/quartz.
 *
 * All anchors live in TRACE_PATCHES. If Quartz core changes upstream and an
 * anchor disappears, applyPatches() throws listing every broken anchor — update
 * the table, not the call sites.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface SourcePatch {
  /** Short id used in error messages. */
  id: string;
  /** Path relative to the sandbox root. */
  file: string;
  /** Exact text that must occur exactly once in the file. */
  anchor: string;
  /** Where `text` goes relative to the anchor. */
  position: "before" | "after" | "replace";
  text: string;
  /** Why the patch exists (shown in errors). */
  purpose: string;
}

const RUNTIME_IMPORT = "./plugins/_trace/runtime";

export const TRACE_PATCHES: SourcePatch[] = [
  {
    id: "build-instrument",
    file: "quartz/build.ts",
    anchor: 'import cfg from "../quartz"\n',
    position: "after",
    text:
      `import { instrumentConfig as __traceInstrument, flushTrace as __traceFlush } from "${RUNTIME_IMPORT}"\n` +
      "__traceInstrument(cfg)\n",
    purpose:
      "wrap every transformer/filter/emitter/pageType instance once the config is loaded",
  },
  {
    id: "build-flush",
    file: "quartz/build.ts",
    anchor: "await emitContent(ctx, filteredContent)\n",
    position: "after",
    text: "  __traceFlush()\n",
    purpose: "write trace.json as soon as the first full build finished",
  },
  {
    id: "vfile-import",
    file: "quartz/plugins/vfile.ts",
    anchor: 'import { Data, VFile } from "vfile"\n',
    position: "after",
    text: 'import { wrapVirtualData as __traceWrapVirtual } from "./_trace/runtime"\n',
    purpose: "import the virtual-page data wrapper",
  },
  {
    id: "vfile-virtual-data",
    file: "quartz/plugins/vfile.ts",
    anchor: "vfile.data = vfileData",
    position: "replace",
    text: "vfile.data = __traceWrapVirtual(vfileData)",
    purpose: "record reads of virtual pages' (tag/folder/bases pages) data",
  },
];

/** Files copied verbatim into the sandbox (source -> sandbox-relative target). */
export const RUNTIME_FILES: Array<{ from: string; to: string }> = [
  {
    from: join(import.meta.dirname, "runtime.ts"),
    to: "quartz/plugins/_trace/runtime.ts",
  },
  {
    from: join(import.meta.dirname, "recorder.ts"),
    to: "quartz/plugins/_trace/recorder.ts",
  },
];

export class PatchError extends Error {
  constructor(readonly failures: string[]) {
    super(
      `Trace instrumentation could not be applied (${failures.length} anchor(s) broken):\n` +
        failures.map((f) => `  - ${f}`).join("\n") +
        "\nQuartz core probably changed upstream. Update TRACE_PATCHES in scripts/lib/trace/patches.ts.",
    );
    this.name = "PatchError";
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, i + needle.length)
  ) {
    count++;
  }
  return count;
}

/**
 * Apply patches to in-memory sources (pure). Already-applied patches are
 * skipped, so applying twice is a no-op. Throws PatchError listing *all*
 * failures, not just the first.
 */
export function applyPatches(
  sources: Record<string, string>,
  patches: SourcePatch[] = TRACE_PATCHES,
): Record<string, string> {
  const out = { ...sources };
  const failures: string[] = [];
  for (const patch of patches) {
    const src = out[patch.file];
    if (src === undefined) {
      failures.push(
        `${patch.id}: file ${patch.file} not found (${patch.purpose})`,
      );
      continue;
    }
    const applied =
      patch.position === "replace"
        ? patch.text
        : patch.position === "after"
          ? patch.anchor + patch.text
          : patch.text + patch.anchor;
    if (src.includes(applied)) continue;
    const n = countOccurrences(src, patch.anchor);
    if (n !== 1) {
      failures.push(
        `${patch.id}: expected exactly 1 occurrence of ${JSON.stringify(patch.anchor)} in ${patch.file}, found ${n} (${patch.purpose})`,
      );
      continue;
    }
    out[patch.file] = src.replace(patch.anchor, () => applied);
  }
  if (failures.length) throw new PatchError(failures);
  return out;
}

/** Patch a sandbox on disk and copy the runtime in. Invalidates the transpile cache. */
export function instrumentSandbox(sandboxDir: string): string[] {
  const files = [...new Set(TRACE_PATCHES.map((p) => p.file))];
  const sources: Record<string, string> = {};
  for (const file of files) {
    const path = join(sandboxDir, file);
    if (existsSync(path)) sources[file] = readFileSync(path, "utf-8");
  }
  const patched = applyPatches(sources);
  for (const file of files) {
    if (patched[file] !== sources[file])
      writeFileSync(join(sandboxDir, file), patched[file]!);
  }
  for (const { from, to } of RUNTIME_FILES) {
    const target = join(sandboxDir, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(from, target);
  }
  // esbuild re-bundles on every build, but drop stale output so a failed bundle
  // can never silently run an uninstrumented transpile.
  for (const stale of [
    "transpiled-build.mjs",
    "transpiled-build.mjs.map",
    "transpiled-worker.mjs",
  ]) {
    rmSync(join(sandboxDir, "quartz/.quartz-cache", stale), { force: true });
  }
  return files;
}
