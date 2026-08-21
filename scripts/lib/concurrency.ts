export interface ConcurrencyFailure<T> {
  item: T;
  error: Error;
}

export interface ConcurrencyResult<T> {
  failures: ConcurrencyFailure<T>[];
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<ConcurrencyResult<T>> {
  if (limit <= 0) throw new Error("Concurrency limit must be > 0");
  if (limit > 32) throw new Error("Concurrency limit must be <= 32");

  const queue = [...items];
  const failures: ConcurrencyFailure<T>[] = [];
  const runners: Promise<void>[] = [];

  const runNext = async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      try {
        await worker(item);
      } catch (error) {
        failures.push({
          item,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  };

  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    runners.push(runNext());
  }
  await Promise.all(runners);

  return { failures };
}
