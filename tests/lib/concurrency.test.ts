import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "../../scripts/lib/concurrency.js";

describe("runWithConcurrency", () => {
  it("all items succeed → empty failures array", async () => {
    const result = await runWithConcurrency(
      [1, 2, 3],
      3,
      async () => {},
    );
    expect(result.failures).toEqual([]);
  });

  it("some items fail → failures collected with correct items and errors", async () => {
    const result = await runWithConcurrency(
      ["ok", "fail", "ok2", "fail2"],
      2,
      async (item) => {
        if (item.startsWith("fail")) {
          throw new Error(`Error on ${item}`);
        }
      },
    );
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].item).toBe("fail");
    expect(result.failures[0].error.message).toBe("Error on fail");
    expect(result.failures[1].item).toBe("fail2");
    expect(result.failures[1].error.message).toBe("Error on fail2");
  });

  it("limit 0 → throws", async () => {
    await expect(
      runWithConcurrency([], 0, async () => {}),
    ).rejects.toThrow("Concurrency limit must be > 0");
  });

  it("limit > 32 → throws", async () => {
    await expect(
      runWithConcurrency([], 33, async () => {}),
    ).rejects.toThrow("Concurrency limit must be <= 32");
  });

  it("empty items array → succeeds immediately", async () => {
    const result = await runWithConcurrency([], 5, async () => {});
    expect(result.failures).toEqual([]);
  });

  it("concurrency is respected (max N concurrent workers)", async () => {
    let activeConcurrent = 0;
    let maxConcurrent = 0;
    const limit = 2;

    await runWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      limit,
      async () => {
        activeConcurrent++;
        if (activeConcurrent > maxConcurrent) {
          maxConcurrent = activeConcurrent;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeConcurrent--;
      },
    );

    expect(maxConcurrent).toBeLessThanOrEqual(limit);
    expect(maxConcurrent).toBeGreaterThan(0);
  });

  it("processes all items even when some fail", async () => {
    const processed: number[] = [];
    const result = await runWithConcurrency(
      [1, 2, 3, 4],
      2,
      async (item) => {
        processed.push(item);
        if (item === 2) throw new Error("boom");
      },
    );
    expect(processed).toEqual([1, 2, 3, 4]);
    expect(result.failures).toHaveLength(1);
  });
});
