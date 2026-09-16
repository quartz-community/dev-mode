import type { PeerConsistencyPackage } from "./peer-consistency.js";

export interface BuildTimePeerCheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

// Quartz plugin tsup configs deliberately leave these host-provided singletons external.
export const SINGLETON_EXTERNALS = [
  "preact",
  "@jackyzha0/quartz",
  "vfile",
] as const;

function isEcosystemPackage(name: string): boolean {
  return (
    name.startsWith("@quartz-community/") || name.startsWith("@quartz-themes/")
  );
}

function isSingletonExternal(name: string): boolean {
  return SINGLETON_EXTERNALS.some(
    (singleton) => name === singleton || name.startsWith(`${singleton}/`),
  );
}

export function checkBuildTimePeerAvailability(
  packages: PeerConsistencyPackage[],
): BuildTimePeerCheckResult {
  const details: string[] = [];
  let ok = true;

  for (const pkg of packages) {
    if (!pkg.name?.startsWith("@quartz-")) continue;
    const available = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [peerName, peerRange] of Object.entries(
      pkg.peerDependencies ?? {},
    )) {
      if (
        isEcosystemPackage(peerName) ||
        peerName === "@jackyzha0/quartz" ||
        isSingletonExternal(peerName) ||
        available[peerName]
      ) {
        continue;
      }

      const optional = pkg.peerDependenciesMeta?.[peerName]?.optional === true;
      const detail = `${pkg.name}@${pkg.version ?? "unknown"} peer ${peerName} ${peerRange} is not in devDependencies; source builds will fail under legacy-peer-deps [${optional ? "optional" : "required"}]`;
      if (optional) {
        details.push(`warning: ${detail}`);
      } else {
        ok = false;
        details.push(detail);
      }
    }
  }

  return { name: "Build-time peer availability", ok, details };
}
