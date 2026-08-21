import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/lib/args.js";

describe("parseArgs", () => {
  it("parses --key value pairs", () => {
    const result = parseArgs(["--name", "foo"]);
    expect(result.flags).toEqual({ name: "foo" });
    expect(result.positional).toEqual([]);
  });

  it("parses --key=value pairs", () => {
    const result = parseArgs(["--name=bar"]);
    expect(result.flags).toEqual({ name: "bar" });
    expect(result.positional).toEqual([]);
  });

  it("parses boolean flags (no value)", () => {
    const result = parseArgs(["--verbose"]);
    expect(result.flags).toEqual({ verbose: true });
  });

  it("treats flag followed by another flag as boolean", () => {
    const result = parseArgs(["--verbose", "--debug"]);
    expect(result.flags).toEqual({ verbose: true, debug: true });
  });

  it("collects positional arguments", () => {
    const result = parseArgs(["foo", "bar"]);
    expect(result.positional).toEqual(["foo", "bar"]);
    expect(result.flags).toEqual({});
  });

  it("handles -- sentinel (remaining args become positional)", () => {
    const result = parseArgs(["--name", "foo", "--", "--not-a-flag", "baz"]);
    expect(result.flags).toEqual({ name: "foo" });
    expect(result.positional).toEqual(["--not-a-flag", "baz"]);
  });

  it("handles mixed flags and positional", () => {
    const result = parseArgs(["pos1", "--flag", "val", "pos2"]);
    expect(result.flags).toEqual({ flag: "val" });
    expect(result.positional).toEqual(["pos1", "pos2"]);
  });

  it("handles empty input", () => {
    const result = parseArgs([]);
    expect(result.flags).toEqual({});
    expect(result.positional).toEqual([]);
  });

  it("handles --key=value with equals in value", () => {
    const result = parseArgs(["--expr=a=b"]);
    expect(result.flags).toEqual({ expr: "a=b" });
  });
});
