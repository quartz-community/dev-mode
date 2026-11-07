import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChangesetParseError,
  maxBump,
  parseChangeset,
  pendingBumpFor,
  readPendingChangesets,
  renderChangeset,
  slugify,
  uniqueChangesetFile,
  writeChangeset,
} from "../scripts/lib/release/changeset.js";

const dirs: string[] = [];
function tempRepo(withChangesetDir = true): string {
  const dir = mkdtempSync(join(tmpdir(), "release-cs-"));
  dirs.push(dir);
  if (withChangesetDir) {
    mkdirSync(join(dir, ".changeset"));
    writeFileSync(join(dir, ".changeset", "config.json"), "{}\n");
    writeFileSync(join(dir, ".changeset", "README.md"), "# Changesets\n");
  }
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("parseChangeset", () => {
  it("parses double-quoted, single-quoted and bare names", () => {
    const parsed = parseChangeset(
      `---\n"@quartz-community/utils": minor\n'@quartz-community/types': patch\nplain-pkg: major\n---\n\nAdd a thing\n\nMore detail.\n`,
    );
    expect(parsed.releases).toEqual([
      { name: "@quartz-community/utils", bump: "minor" },
      { name: "@quartz-community/types", bump: "patch" },
      { name: "plain-pkg", bump: "major" },
    ]);
    expect(parsed.summary).toBe("Add a thing\n\nMore detail.");
  });

  it("accepts CRLF, `none` bumps and an empty frontmatter", () => {
    expect(
      parseChangeset(`---\r\n"a": none\r\n---\r\n\r\nx\r\n`).releases,
    ).toEqual([{ name: "a", bump: "none" }]);
    expect(parseChangeset("---\n---\n\nempty\n").releases).toEqual([]);
  });

  it("rejects missing frontmatter and invalid bump types", () => {
    expect(() => parseChangeset("just text")).toThrow(ChangesetParseError);
    expect(() => parseChangeset(`---\n"a": huge\n---\n\nx\n`)).toThrow(
      /invalid frontmatter line/,
    );
  });
});

describe("renderChangeset", () => {
  it("renders the changesets format and round-trips", () => {
    const content = renderChangeset(
      [{ name: "@quartz-community/graph", bump: "patch" }],
      "  Fix it  ",
    );
    expect(content).toBe(
      `---\n"@quartz-community/graph": patch\n---\n\nFix it\n`,
    );
    expect(parseChangeset(content)).toEqual({
      releases: [{ name: "@quartz-community/graph", bump: "patch" }],
      summary: "Fix it",
    });
  });

  it("refuses empty summaries and empty release lists", () => {
    expect(() =>
      renderChangeset([{ name: "a", bump: "patch" }], "  "),
    ).toThrow();
    expect(() => renderChangeset([], "x")).toThrow();
  });
});

describe("slug helpers", () => {
  it("slugifies summaries", () => {
    expect(slugify("Fix: Graph résumé  rendering!")).toBe(
      "fix-graph-resume-rendering",
    );
    expect(slugify("!!!")).toBe("changeset");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(48);
  });

  it("avoids collisions", () => {
    expect(uniqueChangesetFile("x", new Set())).toBe("x.md");
    expect(uniqueChangesetFile("x", new Set(["x.md", "x-2.md"]))).toBe(
      "x-3.md",
    );
  });
});

describe("maxBump / pendingBumpFor", () => {
  it("takes the highest bump", () => {
    expect(maxBump("patch", "minor")).toBe("minor");
    expect(maxBump("major", "minor")).toBe("major");
    expect(maxBump(undefined, "patch")).toBe("patch");
    expect(maxBump("none", undefined)).toBe("none");
  });

  it("aggregates pending changesets per package", () => {
    const pending = [
      {
        file: "a.md",
        summary: "",
        releases: [{ name: "p", bump: "patch" as const }],
      },
      {
        file: "b.md",
        summary: "",
        releases: [
          { name: "p", bump: "minor" as const },
          { name: "q", bump: "major" as const },
        ],
      },
    ];
    expect(pendingBumpFor(pending, "p")).toBe("minor");
    expect(pendingBumpFor(pending, "q")).toBe("major");
    expect(pendingBumpFor(pending, "r")).toBeUndefined();
  });
});

describe("readPendingChangesets / writeChangeset", () => {
  it("ignores README.md and config.json and reports invalid files", () => {
    const repo = tempRepo();
    writeFileSync(
      join(repo, ".changeset", "ok.md"),
      `---\n"p": minor\n---\n\nok\n`,
    );
    writeFileSync(join(repo, ".changeset", "bad.md"), "no frontmatter");
    const result = readPendingChangesets(repo);
    expect(result.hasChangesetDir).toBe(true);
    expect(result.pending.map((p) => p.file)).toEqual(["ok.md"]);
    expect(result.errors.map((e) => e.file)).toEqual(["bad.md"]);
  });

  it("reports repos without a .changeset dir", () => {
    expect(readPendingChangesets(tempRepo(false))).toEqual({
      hasChangesetDir: false,
      pending: [],
      errors: [],
    });
  });

  it("writes a changeset file that reads back as pending", () => {
    const repo = tempRepo();
    const result = writeChangeset({
      repoPath: repo,
      packageName: "@quartz-community/graph",
      bump: "minor",
      summary: "Add zoom controls",
    });
    expect(result.written).toBe(true);
    expect(result.path).toBe(join(repo, ".changeset", "add-zoom-controls.md"));
    expect(readFileSync(result.path, "utf-8")).toBe(
      `---\n"@quartz-community/graph": minor\n---\n\nAdd zoom controls\n`,
    );
    const again = writeChangeset({
      repoPath: repo,
      packageName: "@quartz-community/graph",
      bump: "patch",
      summary: "Add zoom controls",
    });
    expect(again.path.endsWith("add-zoom-controls-2.md")).toBe(true);
    expect(
      pendingBumpFor(
        readPendingChangesets(repo).pending,
        "@quartz-community/graph",
      ),
    ).toBe("minor");
  });

  it("does not write in dry-run mode", () => {
    const repo = tempRepo();
    const result = writeChangeset({
      repoPath: repo,
      packageName: "p",
      bump: "patch",
      summary: "x",
      name: "custom-name",
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(result.path.endsWith("custom-name.md")).toBe(true);
    expect(readdirSync(join(repo, ".changeset")).sort()).toEqual([
      "README.md",
      "config.json",
    ]);
  });

  it("refuses repos without a .changeset dir and invalid bumps", () => {
    expect(() =>
      writeChangeset({
        repoPath: tempRepo(false),
        packageName: "p",
        bump: "patch",
        summary: "x",
      }),
    ).toThrow(/no \.changeset directory/);
    expect(() =>
      writeChangeset({
        repoPath: tempRepo(),
        packageName: "p",
        bump: "huge" as never,
        summary: "x",
      }),
    ).toThrow(/invalid bump/);
  });
});
