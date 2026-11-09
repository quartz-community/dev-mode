import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  patchCiWorkflow,
  patchReleaseWorkflow,
  type PatchResult,
} from "../scripts/lib/version-pr-ci.js";

const fixture = (name: string) =>
  readFileSync(
    join(import.meta.dirname, "fixtures", "version-pr-ci", name),
    "utf-8",
  );

function patched(result: PatchResult): string {
  if (result.status !== "patched") throw new Error(JSON.stringify(result));
  return result.text;
}

describe("patchCiWorkflow", () => {
  it("reproduces the note-properties prototype byte for byte", () => {
    expect(patched(patchCiWorkflow(fixture("ci.yml")))).toBe(
      fixture("ci.expected.yml"),
    );
  });

  it("is idempotent", () => {
    expect(patchCiWorkflow(fixture("ci.expected.yml"))).toEqual({
      status: "unchanged",
    });
  });

  it("gives every checkout the ref and stays valid YAML", () => {
    const text = patched(
      patchCiWorkflow(
        fixture("ci.yml").replace(
          "jobs:\n",
          "jobs:\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - run: true\n",
        ),
      ),
    );
    const doc = parse(text) as {
      jobs: Record<string, { steps: { with?: { ref?: string } }[] }>;
    };
    expect(doc.jobs.other.steps[0].with?.ref).toBe("${{ inputs.ref }}");
    expect(doc.jobs.check.steps[0].with?.ref).toBe("${{ inputs.ref }}");
  });

  it("leaves unusual workflows for a person", () => {
    expect(patchCiWorkflow("on: [push]\n\njobs:\n").status).toBe("manual");
    expect(
      patchCiWorkflow(
        fixture("ci.yml").replace(
          "actions/checkout@v4\n",
          "actions/checkout@v4\n        with:\n          fetch-depth: 0\n",
        ),
      ).status,
    ).toBe("manual");
  });
});

describe("patchReleaseWorkflow", () => {
  it("reproduces the note-properties prototype byte for byte (trusted publishing)", () => {
    expect(patched(patchReleaseWorkflow(fixture("release-oidc.yml")))).toBe(
      fixture("release-oidc.expected.yml"),
    );
  });

  it("patches the npm-token variant the same way, keeping its publishing untouched", () => {
    const source = fixture("release-token.yml");
    const text = patched(patchReleaseWorkflow(source));
    const doc = parse(text) as {
      jobs: Record<
        string,
        {
          outputs?: Record<string, string>;
          permissions?: Record<string, string>;
          steps?: { id?: string; env?: Record<string, string> }[];
          uses?: string;
        }
      >;
    };
    expect(Object.keys(doc.jobs)).toEqual([
      "release",
      "version-pr-ci",
      "version-pr-status",
    ]);
    expect(doc.jobs.release.permissions?.statuses).toBe("write");
    expect(doc.jobs.release.outputs?.["pr-sha"]).toBe(
      "${{ steps.version-pr.outputs.sha }}",
    );
    const steps = doc.jobs.release.steps ?? [];
    const changesets = steps.find((s) => s.id === "changesets");
    expect(changesets?.env?.NPM_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
    expect(steps.at(-1)?.id).toBe("version-pr");
    expect(doc.jobs["version-pr-ci"].uses).toBe("./.github/workflows/ci.yml");
    // everything that was there is still there, in order
    expect(
      text.startsWith(
        source.replace(/\n$/, "").split("      id-token: write\n")[0],
      ),
    ).toBe(true);
  });

  it("is idempotent", () => {
    expect(patchReleaseWorkflow(fixture("release-oidc.expected.yml"))).toEqual({
      status: "unchanged",
    });
  });

  it("refuses when the changesets step isn't last", () => {
    const source = fixture("release-token.yml") + "      - run: echo after\n";
    expect(patchReleaseWorkflow(source).status).toBe("manual");
  });
});
