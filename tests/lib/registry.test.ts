import { describe, expect, it } from "vitest";
import {
  isRetryableRegistryStatus,
  registryUrl,
} from "../../scripts/lib/registry.js";

describe("registryUrl", () => {
  it("encodes scoped package slashes", () => {
    expect(registryUrl("@quartz-community/types")).toBe(
      "https://registry.npmjs.org/%40quartz-community%2Ftypes",
    );
  });
});

describe("isRetryableRegistryStatus", () => {
  it.each([429, 502, 503])("retries status %i", (status) => {
    expect(isRetryableRegistryStatus(status)).toBe(true);
  });

  it.each([400, 401, 404, 500])("does not retry status %i", (status) => {
    expect(isRetryableRegistryStatus(status)).toBe(false);
  });
});
