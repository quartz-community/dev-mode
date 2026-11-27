/** Minimal source map v3 reader (VLQ mappings → offset lookups). No dependencies. */

export interface RawSourceMap {
  version: number;
  sources: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings: string;
}

export interface OriginalPosition {
  source: string;
  /** 0-based */
  line: number;
  /** 0-based, UTF-16 */
  column: number;
  name?: string;
}

interface Mapping {
  genColumn: number;
  source?: number;
  line?: number;
  column?: number;
  name?: number;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Decode one comma-free VLQ segment into its numbers. */
export function decodeVlqSegment(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64_INDEX.get(ch);
    if (digit === undefined) throw new Error(`invalid VLQ character ${ch}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/** Decode `mappings` into per-generated-line mapping lists (sorted by column). */
export function decodeMappings(mappings: string): Mapping[][] {
  const lines: Mapping[][] = [];
  let source = 0;
  let line = 0;
  let column = 0;
  let name = 0;
  for (const lineText of mappings.split(";")) {
    let genColumn = 0;
    const row: Mapping[] = [];
    if (lineText) {
      for (const seg of lineText.split(",")) {
        if (!seg) continue;
        const v = decodeVlqSegment(seg);
        genColumn += v[0];
        const m: Mapping = { genColumn };
        if (v.length >= 4) {
          source += v[1];
          line += v[2];
          column += v[3];
          m.source = source;
          m.line = line;
          m.column = column;
          if (v.length >= 5) {
            name += v[4];
            m.name = name;
          }
        }
        row.push(m);
      }
    }
    row.sort((a, b) => a.genColumn - b.genColumn);
    lines.push(row);
  }
  return lines;
}

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1)
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function offsetToLineColumn(
  starts: number[],
  offset: number,
): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: offset - starts[lo] };
}

/** Lookups from offsets in the generated text to original positions. */
export class SourceMapLookup {
  private readonly lines: Mapping[][];
  private readonly genStarts: number[];
  private readonly contentStarts = new Map<number, number[]>();

  constructor(
    readonly map: RawSourceMap,
    generated: string,
  ) {
    this.lines = decodeMappings(map.mappings);
    this.genStarts = lineStarts(generated);
  }

  /**
   * Original position of the generated offset: the closest mapping at or before
   * it on the same line. `exact` requires a mapping starting exactly there.
   */
  originalFor(offset: number, exact = false): OriginalPosition | undefined {
    const { line, column } = offsetToLineColumn(this.genStarts, offset);
    const row = this.lines[line];
    if (!row) return undefined;
    let found: Mapping | undefined;
    for (const m of row) {
      if (m.genColumn > column) break;
      found = m;
    }
    if (!found || found.source === undefined) return undefined;
    if (exact && found.genColumn !== column) return undefined;
    return {
      source: this.map.sources[found.source],
      line: found.line!,
      column: found.column!,
      name: found.name !== undefined ? this.map.names?.[found.name] : undefined,
    };
  }

  /** The original source line text for a position, when sourcesContent has it. */
  sourceLine(pos: OriginalPosition): string | undefined {
    const index = this.map.sources.indexOf(pos.source);
    const content = this.map.sourcesContent?.[index];
    if (content == null) return undefined;
    let starts = this.contentStarts.get(index);
    if (!starts) {
      starts = lineStarts(content);
      this.contentStarts.set(index, starts);
    }
    const start = starts[pos.line];
    if (start === undefined) return undefined;
    const end = starts[pos.line + 1] ?? content.length;
    return content.slice(start, end).replace(/\r?\n$/, "");
  }
}
