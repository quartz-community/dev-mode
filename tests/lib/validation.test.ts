import { describe, expect, it } from "vitest";
import { validatePluginName } from "../../scripts/lib/validation.js";

describe("validatePluginName", () => {
  it("accepts valid names", () => {
    expect(() => validatePluginName("syntax-highlighting")).not.toThrow();
    expect(() => validatePluginName("a")).not.toThrow();
    expect(() => validatePluginName("a1")).not.toThrow();
    expect(() => validatePluginName("test-plugin-123")).not.toThrow();
  });

  it("throws on empty string", () => {
    expect(() => validatePluginName("")).toThrow("Plugin name is required");
  });

  it("throws on path traversal", () => {
    expect(() => validatePluginName("../../../etc")).toThrow("Invalid plugin name");
  });

  it("throws on leading hyphen", () => {
    expect(() => validatePluginName("-foo")).toThrow("Invalid plugin name");
  });

  it("throws on trailing hyphen", () => {
    expect(() => validatePluginName("foo-")).toThrow("Invalid plugin name");
  });

  it("throws on uppercase letters", () => {
    expect(() => validatePluginName("FOO")).toThrow("Invalid plugin name");
  });

  it("throws on spaces", () => {
    expect(() => validatePluginName("foo bar")).toThrow("Invalid plugin name");
  });

  it("throws on names longer than 64 characters", () => {
    const longName = "a".repeat(65);
    expect(() => validatePluginName(longName)).toThrow("Plugin name too long");
  });

  it("accepts names exactly 64 characters", () => {
    const maxName = "a".repeat(64);
    expect(() => validatePluginName(maxName)).not.toThrow();
  });
});
