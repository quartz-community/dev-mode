import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { runWithConcurrency } from "./concurrency.js";
import { safeReadJson } from "./json.js";

const REGISTRY = "https://registry.npmjs.org";
const ACCEPT = "application/vnd.npm.install-v1+json";
const USER_AGENT = "@quartz-community/dev-mode doctor";
const MAX_ATTEMPTS = 4;

export interface RegistryCheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

interface PackageJson {
  name?: string;
  private?: boolean;
}

interface RegistryVersion {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Packument {
  name?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, RegistryVersion>;
}

export function registryUrl(packageName: string): string {
  return `${REGISTRY}/${encodeURIComponent(packageName)}`;
}

export function isRetryableRegistryStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function fetchPackument(packageName: string): Promise<Packument> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(registryUrl(packageName), {
        headers: { Accept: ACCEPT, "User-Agent": USER_AGENT },
      });
      if (response.ok) return (await response.json()) as Packument;

      const message = `registry returned ${response.status} ${response.statusText}`;
      if (
        !isRetryableRegistryStatus(response.status) ||
        attempt === MAX_ATTEMPTS
      ) {
        throw new Error(message);
      }
    } catch (error) {
      const retryableResponseError =
        error instanceof Error &&
        error.message.startsWith("registry returned ");
      if (attempt === MAX_ATTEMPTS || retryableResponseError) {
        throw error;
      }
    }
    await delay(250 * 2 ** (attempt - 1));
  }
  throw new Error("registry request exhausted retries");
}

function getEcosystemPackages(reposDir: string): string[] {
  if (!existsSync(reposDir)) return [];
  return readdirSync(reposDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(reposDir, entry.name, "package.json"))
    .filter(existsSync)
    .map((path) => safeReadJson<PackageJson>(path))
    .filter(
      (pkg): pkg is PackageJson & { name: string } =>
        pkg.private !== true &&
        typeof pkg.name === "string" &&
        (pkg.name.startsWith("@quartz-community/") ||
          pkg.name.startsWith("@quartz-themes/")),
    )
    .map((pkg) => pkg.name);
}

export async function checkRegistryReachability(
  root: string,
): Promise<RegistryCheckResult> {
  const packageNames = getEcosystemPackages(join(root, "repos"));
  if (packageNames.length === 0) {
    return {
      name: "Ecosystem reachability",
      ok: false,
      details: [
        "registry check infrastructure failure: no ecosystem packages found in repos/",
      ],
    };
  }
  const packuments = new Map<string, Packument>();
  const fetchResult = await runWithConcurrency(
    packageNames,
    8,
    async (packageName) => {
      packuments.set(packageName, await fetchPackument(packageName));
    },
  );

  const details = fetchResult.failures.map(
    ({ item, error }) =>
      `registry/network failure for ${item}: ${error.message}`,
  );
  const ecosystem = new Set(packageNames);

  for (const packageName of packageNames) {
    const packument = packuments.get(packageName);
    if (!packument) continue;
    const latest = packument["dist-tags"]?.latest;
    const published = latest ? packument.versions?.[latest] : undefined;
    if (!latest || !published) {
      details.push(
        `registry data failure for ${packageName}: latest version metadata is missing`,
      );
      continue;
    }

    for (const [kind, dependencies] of [
      ["dependency", published.dependencies],
      ["peer dependency", published.peerDependencies],
    ] as const) {
      for (const [dependencyName, range] of Object.entries(
        dependencies ?? {},
      )) {
        if (!ecosystem.has(dependencyName)) continue;
        const dependencyPackument = packuments.get(dependencyName);
        const dependencyLatest = dependencyPackument?.["dist-tags"]?.latest;
        if (!dependencyLatest) {
          details.push(
            `registry data failure for ${packageName}@${latest}: latest version for ${dependencyName} is missing`,
          );
          continue;
        }
        if (
          !semver.satisfies(dependencyLatest, range, {
            includePrerelease: false,
          })
        ) {
          const detail = `${packageName}@${latest} requires ${dependencyName} ${range} but latest is ${dependencyLatest} (unreachable)`;
          details.push(
            kind === "peer dependency" ? `peer dependency: ${detail}` : detail,
          );
        }
      }
    }
  }

  return { name: "Ecosystem reachability", ok: details.length === 0, details };
}
