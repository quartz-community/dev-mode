import { describe, expect, it } from "vitest";
import {
  parseVersion,
  compareSemver,
  bumpMajor,
  bumpMinor,
  parsePartialVersion,
  expandToken,
  satisfiesRange,
} from "../../scripts/lib/semver.js";

describe("parseVersion", () => {
  it("parses standard semver", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("strips leading v", () => {
    expect(parseVersion("v2.0.1")).toEqual({ major: 2, minor: 0, patch: 1 });
  });

  it("handles partial versions (major only)", () => {
    expect(parseVersion("5")).toEqual({ major: 5, minor: 0, patch: 0 });
  });

  it("handles partial versions (major.minor)", () => {
    expect(parseVersion("3.4")).toEqual({ major: 3, minor: 4, patch: 0 });
  });

  it("defaults non-finite parts to 0", () => {
    expect(parseVersion("abc")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("parses 0.0.0", () => {
    expect(parseVersion("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });
});

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(
      compareSemver(
        { major: 1, minor: 2, patch: 3 },
        { major: 1, minor: 2, patch: 3 },
      ),
    ).toBe(0);
  });

  it("compares major first", () => {
    expect(
      compareSemver(
        { major: 2, minor: 0, patch: 0 },
        { major: 1, minor: 9, patch: 9 },
      ),
    ).toBeGreaterThan(0);
  });

  it("compares minor second", () => {
    expect(
      compareSemver(
        { major: 1, minor: 3, patch: 0 },
        { major: 1, minor: 2, patch: 9 },
      ),
    ).toBeGreaterThan(0);
  });

  it("compares patch last", () => {
    expect(
      compareSemver(
        { major: 1, minor: 2, patch: 4 },
        { major: 1, minor: 2, patch: 3 },
      ),
    ).toBeGreaterThan(0);
  });
});

describe("bumpMajor", () => {
  it("increments major and resets minor and patch", () => {
    expect(bumpMajor({ major: 1, minor: 5, patch: 3 })).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
    });
  });
});

describe("bumpMinor", () => {
  it("increments minor and resets patch", () => {
    expect(bumpMinor({ major: 1, minor: 5, patch: 3 })).toEqual({
      major: 1,
      minor: 6,
      patch: 0,
    });
  });
});

describe("parsePartialVersion", () => {
  it("parses full version", () => {
    expect(parsePartialVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  it("parses major only", () => {
    expect(parsePartialVersion("4")).toEqual({ major: 4, minor: 0, patch: 0 });
  });

  it("parses major.minor", () => {
    expect(parsePartialVersion("2.7")).toEqual({
      major: 2,
      minor: 7,
      patch: 0,
    });
  });

  it("returns null for non-numeric input", () => {
    expect(parsePartialVersion("abc")).toBeNull();
  });
});

describe("expandToken", () => {
  it("returns empty for *", () => {
    expect(expandToken("*")).toEqual([]);
  });

  it("returns empty for empty string", () => {
    expect(expandToken("")).toEqual([]);
  });

  it("expands caret range", () => {
    expect(expandToken("^1.2.3")).toEqual([
      { op: ">=", version: { major: 1, minor: 2, patch: 3 } },
      { op: "<", version: { major: 2, minor: 0, patch: 0 } },
    ]);
  });

  it("expands 0.x caret ranges at the left-most non-zero component", () => {
    expect(expandToken("^0.2.3")).toEqual([
      { op: ">=", version: { major: 0, minor: 2, patch: 3 } },
      { op: "<", version: { major: 0, minor: 3, patch: 0 } },
    ]);
    expect(expandToken("^0.0.3")).toEqual([
      { op: ">=", version: { major: 0, minor: 0, patch: 3 } },
      { op: "<", version: { major: 0, minor: 0, patch: 4 } },
    ]);
  });

  it("expands tilde range", () => {
    expect(expandToken("~1.2.3")).toEqual([
      { op: ">=", version: { major: 1, minor: 2, patch: 3 } },
      { op: "<", version: { major: 1, minor: 3, patch: 0 } },
    ]);
  });

  it("expands explicit operator", () => {
    expect(expandToken(">=2.0.0")).toEqual([
      { op: ">=", version: { major: 2, minor: 0, patch: 0 } },
    ]);
  });

  it("expands exact version (no operator)", () => {
    expect(expandToken("1.2.3")).toEqual([
      { op: "=", version: { major: 1, minor: 2, patch: 3 } },
    ]);
  });

  it("expands x-range (major.x)", () => {
    expect(expandToken("2.x")).toEqual([
      { op: ">=", version: { major: 2, minor: 0, patch: 0 } },
      { op: "<", version: { major: 3, minor: 0, patch: 0 } },
    ]);
  });
});

describe("satisfiesRange", () => {
  it("* matches everything", () => {
    expect(satisfiesRange({ major: 99, minor: 0, patch: 0 }, "*")).toBe(true);
  });

  it("empty string matches everything", () => {
    expect(satisfiesRange({ major: 1, minor: 0, patch: 0 }, "")).toBe(true);
  });

  it("^1.2.3 matches 1.x.x >= 1.2.3", () => {
    expect(satisfiesRange({ major: 1, minor: 5, patch: 0 }, "^1.2.3")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 1, minor: 2, patch: 3 }, "^1.2.3")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 1, minor: 99, patch: 99 }, "^1.2.3")).toBe(
      true,
    );
  });

  it("^1.2.3 rejects 2.x", () => {
    expect(satisfiesRange({ major: 2, minor: 0, patch: 0 }, "^1.2.3")).toBe(
      false,
    );
  });

  it("^1.2.3 rejects versions below range", () => {
    expect(satisfiesRange({ major: 1, minor: 2, patch: 2 }, "^1.2.3")).toBe(
      false,
    );
    expect(satisfiesRange({ major: 1, minor: 1, patch: 0 }, "^1.2.3")).toBe(
      false,
    );
  });

  it("~1.2.3 matches 1.2.x >= 1.2.3", () => {
    expect(satisfiesRange({ major: 1, minor: 2, patch: 5 }, "~1.2.3")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 1, minor: 2, patch: 3 }, "~1.2.3")).toBe(
      true,
    );
  });

  it("~1.2.3 rejects 1.3.x", () => {
    expect(satisfiesRange({ major: 1, minor: 3, patch: 0 }, "~1.2.3")).toBe(
      false,
    );
  });

  it(">=1 <3 range", () => {
    expect(satisfiesRange({ major: 1, minor: 0, patch: 0 }, ">=1 <3")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 2, minor: 5, patch: 0 }, ">=1 <3")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 3, minor: 0, patch: 0 }, ">=1 <3")).toBe(
      false,
    );
    expect(satisfiesRange({ major: 0, minor: 9, patch: 0 }, ">=1 <3")).toBe(
      false,
    );
  });

  it("|| operator (either side matches)", () => {
    expect(
      satisfiesRange({ major: 1, minor: 0, patch: 0 }, "^1.0.0 || ^2.0.0"),
    ).toBe(true);
    expect(
      satisfiesRange({ major: 2, minor: 0, patch: 0 }, "^1.0.0 || ^2.0.0"),
    ).toBe(true);
    expect(
      satisfiesRange({ major: 3, minor: 0, patch: 0 }, "^1.0.0 || ^2.0.0"),
    ).toBe(false);
  });

  it("explicit version match", () => {
    expect(satisfiesRange({ major: 1, minor: 2, patch: 3 }, "1.2.3")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 1, minor: 2, patch: 4 }, "1.2.3")).toBe(
      false,
    );
  });

  it("^0.0.1 constrains to patch 0.0.1", () => {
    expect(satisfiesRange({ major: 0, minor: 0, patch: 1 }, "^0.0.1")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 0, minor: 5, patch: 0 }, "^0.0.1")).toBe(
      false,
    );
    expect(satisfiesRange({ major: 1, minor: 0, patch: 0 }, "^0.0.1")).toBe(
      false,
    );
  });

  it("^0.1.0 constrains to 0.1.x", () => {
    expect(satisfiesRange({ major: 0, minor: 1, patch: 0 }, "^0.1.0")).toBe(
      true,
    );
    expect(satisfiesRange({ major: 0, minor: 9, patch: 9 }, "^0.1.0")).toBe(
      false,
    );
    expect(satisfiesRange({ major: 1, minor: 0, patch: 0 }, "^0.1.0")).toBe(
      false,
    );
  });

  it("rejects ecosystem-breaking 0.x caret upgrades", () => {
    expect(satisfiesRange(parseVersion("0.3.0"), "^0.2.1")).toBe(false);
    expect(satisfiesRange(parseVersion("0.2.5"), "^0.1.0")).toBe(false);
    expect(satisfiesRange(parseVersion("0.0.4"), "^0.0.3")).toBe(false);
  });
});
