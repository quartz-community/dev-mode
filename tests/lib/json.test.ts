import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { safeReadJson } from "../../scripts/lib/json.js";

describe("safeReadJson", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "json-test-"));
  });

  afterEach(() => {
    try {
      for (const file of readdirSync(tempDir)) {
        unlinkSync(join(tempDir, file));
      }
      rmdirSync(tempDir);
    } catch {}
  });

  it("reads valid JSON file correctly", () => {
    const filePath = join(tempDir, "valid.json");
    writeFileSync(filePath, JSON.stringify({ name: "test", version: "1.0.0" }));

    const result = safeReadJson<{ name: string; version: string }>(filePath);
    expect(result).toEqual({ name: "test", version: "1.0.0" });
  });

  it("reads JSON arrays", () => {
    const filePath = join(tempDir, "array.json");
    writeFileSync(filePath, JSON.stringify([1, 2, 3]));

    const result = safeReadJson<number[]>(filePath);
    expect(result).toEqual([1, 2, 3]);
  });

  it("throws with file path in message for malformed JSON", () => {
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, "{ not valid json }");

    expect(() => safeReadJson(filePath)).toThrow(filePath);
    expect(() => safeReadJson(filePath)).toThrow("Invalid JSON");
  });

  it("throws with file path in message for missing file", () => {
    const filePath = join(tempDir, "nonexistent.json");

    expect(() => safeReadJson(filePath)).toThrow(filePath);
    expect(() => safeReadJson(filePath)).toThrow("Cannot read file");
  });
});
