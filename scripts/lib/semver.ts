export type Semver = { major: number; minor: number; patch: number };

export function parseVersion(raw: string): Semver {
  const clean = raw.startsWith("v") ? raw.slice(1) : raw;
  const [major, minor, patch] = clean.split(".").map((part) => Number(part));
  return {
    major: Number.isFinite(major) ? major : 0,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0,
  };
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function bumpMajor(v: Semver): Semver {
  return { major: v.major + 1, minor: 0, patch: 0 };
}

export function bumpMinor(v: Semver): Semver {
  return { major: v.major, minor: v.minor + 1, patch: 0 };
}

export function parsePartialVersion(input: string): Semver | null {
  const parts = input.split(".");
  const major = Number(parts[0]);
  if (!Number.isFinite(major)) return null;
  const minor = parts.length > 1 ? Number(parts[1]) : 0;
  const patch = parts.length > 2 ? Number(parts[2]) : 0;
  return {
    major,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0,
  };
}

export function expandToken(
  token: string,
): Array<{ op: ">" | ">=" | "<" | "<=" | "="; version: Semver }> {
  if (!token || token === "*") return [];

  if (token.startsWith("^")) {
    const base = parsePartialVersion(token.slice(1));
    if (!base) return [];
    return [
      { op: ">=", version: base },
      { op: "<", version: bumpMajor(base) },
    ];
  }

  if (token.startsWith("~")) {
    const base = parsePartialVersion(token.slice(1));
    if (!base) return [];
    return [
      { op: ">=", version: base },
      { op: "<", version: bumpMinor(base) },
    ];
  }

  if (token.includes("x") || token.includes("*")) {
    const clean = token.replace(/\*/g, "x");
    const parts = clean.split(".");
    const major = Number(parts[0]);
    if (!Number.isFinite(major)) return [];
    if (parts.length === 1 || parts[1] === "x") {
      return [
        { op: ">=", version: { major, minor: 0, patch: 0 } },
        { op: "<", version: { major: major + 1, minor: 0, patch: 0 } },
      ];
    }
    const minor = Number(parts[1]);
    if (!Number.isFinite(minor)) return [];
    return [
      { op: ">=", version: { major, minor, patch: 0 } },
      { op: "<", version: { major, minor: minor + 1, patch: 0 } },
    ];
  }

  const match = token.match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})$/);
  if (!match) return [];
  const op = (match[1] as ">" | ">=" | "<" | "<=" | "=") ?? "=";
  const version = parsePartialVersion(match[2]);
  if (!version) return [];
  return [{ op, version }];
}

export function satisfiesComparator(
  current: Semver,
  comparator: { op: ">" | ">=" | "<" | "<=" | "="; version: Semver },
): boolean {
  const cmp = compareSemver(current, comparator.version);
  switch (comparator.op) {
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case "=":
    default:
      return cmp === 0;
  }
}

export function satisfiesRange(current: Semver, range: string): boolean {
  const trimmed = range.trim();
  if (!trimmed || trimmed === "*") return true;

  const orParts = trimmed
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of orParts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    let ok = true;
    for (const token of tokens) {
      const comparators = expandToken(token);
      for (const comparator of comparators) {
        if (!satisfiesComparator(current, comparator)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) return true;
  }
  return false;
}
