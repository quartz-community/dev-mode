import { runWithConcurrency } from "../concurrency.js";
import { isRetryableRegistryStatus, registryUrl } from "../registry.js";

const ACCEPT = "application/vnd.npm.install-v1+json";
const USER_AGENT = "@quartz-community/dev-mode release";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export interface NpmInfo {
  /** null = package does not exist on npm. */
  latest: string | null;
  versions: string[];
}

class RetryableError extends Error {}

/** Read-only registry lookup with per-request timeout and retries. */
export async function fetchNpmInfo(name: string): Promise<NpmInfo> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(registryUrl(name), {
        headers: { Accept: ACCEPT, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) return { latest: null, versions: [] };
      if (response.ok) {
        const body = (await response.json()) as {
          "dist-tags"?: Record<string, string>;
          versions?: Record<string, unknown>;
        };
        return {
          latest: body["dist-tags"]?.latest ?? null,
          versions: Object.keys(body.versions ?? {}),
        };
      }
      const message = `registry returned ${response.status} ${response.statusText} for ${name}`;
      if (!isRetryableRegistryStatus(response.status)) throw new Error(message);
      lastError = new RetryableError(message);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("registry returned ")
      ) {
        if (!(error instanceof RetryableError)) throw error;
      }
      lastError = error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 300 * 2 ** (attempt - 1)),
    );
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchNpmInfos(
  names: string[],
): Promise<{ results: Map<string, NpmInfo>; errors: Map<string, string> }> {
  const results = new Map<string, NpmInfo>();
  const outcome = await runWithConcurrency(names, 8, async (name) => {
    results.set(name, await fetchNpmInfo(name));
  });
  const errors = new Map(
    outcome.failures.map(({ item, error }) => [item, error.message] as const),
  );
  return { results, errors };
}

/** Splits `name@version` (scoped names allowed). */
export function parsePackageSpec(spec: string): {
  name: string;
  version: string;
} {
  const at = spec.lastIndexOf("@");
  if (at <= 0 || at === spec.length - 1) {
    throw new Error(`expected <name>@<version>, got ${spec}`);
  }
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}
