import semver from "semver";

export interface PeerConsistencyPackage {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export interface PeerConsistencyCheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

function isEcosystemPackage(name: string): boolean {
  return (
    name.startsWith("@quartz-community/") || name.startsWith("@quartz-themes/")
  );
}

export function checkPeerConsistency(
  quartz: PeerConsistencyPackage,
  packages: PeerConsistencyPackage[],
): PeerConsistencyCheckResult {
  const rootDependencies = {
    ...quartz.dependencies,
    ...quartz.devDependencies,
  };
  const quartzPackageNames = new Set(Object.keys(rootDependencies));
  const details: string[] = [];

  for (const pkg of packages) {
    if (
      !pkg.name ||
      !isEcosystemPackage(pkg.name) ||
      !quartzPackageNames.has(pkg.name)
    ) {
      continue;
    }
    for (const [peerName, peerRange] of Object.entries(
      pkg.peerDependencies ?? {},
    )) {
      if (isEcosystemPackage(peerName) || peerName === "@jackyzha0/quartz")
        continue;
      const rootRange = rootDependencies[peerName];
      if (!rootRange) continue;
      const rootVersion = semver.minVersion(rootRange);
      if (!rootVersion || !semver.satisfies(rootVersion, peerRange)) {
        const optional =
          pkg.peerDependenciesMeta?.[peerName]?.optional === true;
        details.push(
          `${pkg.name}@${pkg.version ?? "unknown"} peer ${peerName} ${peerRange} not satisfied by Quartz root ${rootRange} [${optional ? "optional" : "REQUIRED"}]`,
        );
      }
    }
  }

  return {
    name: "Third-party peer consistency",
    ok: details.length === 0,
    details,
  };
}
