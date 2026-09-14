export interface LockfileEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  inBundle?: boolean;
  extraneous?: boolean;
  dev?: boolean;
}

export interface PackageLock {
  packages?: Record<string, LockfileEntry>;
}

export interface NestedDuplicate {
  packageName: string;
  count: number;
  versions: string[];
}

export interface LockfileCheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

const GIT_SOURCE = /^(?:git\+|git:|github:|gitlab:|bitbucket:|ssh:)/i;
const ECOSYSTEM_PACKAGE =
  /node_modules\/(@quartz-(?:community|themes)\/[^/]+)$/;

export function requiresResolvedAndIntegrity(
  path: string,
  entry: LockfileEntry,
  packages: Record<string, LockfileEntry>,
): boolean {
  if (path === "" || entry.link === true || entry.inBundle === true)
    return false;
  if (
    GIT_SOURCE.test(entry.version ?? "") ||
    GIT_SOURCE.test(entry.resolved ?? "")
  ) {
    return false;
  }
  if (
    !path.includes("node_modules/") &&
    Object.entries(packages).some(
      ([otherPath, otherEntry]) =>
        otherPath !== path &&
        otherEntry.link === true &&
        otherEntry.resolved === path,
    )
  ) {
    return false;
  }
  return path.includes("node_modules/");
}

export function detectNestedEcosystemDuplicates(
  packages: Record<string, LockfileEntry>,
): NestedDuplicate[] {
  const duplicates = new Map<
    string,
    { count: number; versions: Set<string> }
  >();
  for (const [path, entry] of Object.entries(packages)) {
    if (path.split("node_modules/").length - 1 < 2) continue;
    const packageName = path.match(ECOSYSTEM_PACKAGE)?.[1];
    if (!packageName) continue;
    const duplicate = duplicates.get(packageName) ?? {
      count: 0,
      versions: new Set<string>(),
    };
    duplicate.count += 1;
    if (entry.version) duplicate.versions.add(entry.version);
    duplicates.set(packageName, duplicate);
  }
  return [...duplicates.entries()]
    .map(([packageName, { count, versions }]) => ({
      packageName,
      count,
      versions: [...versions].sort(),
    }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

export function analyzeLockfile(lockfile: PackageLock): LockfileCheckResult {
  const packages = lockfile.packages ?? {};
  const details: string[] = [];

  for (const [path, entry] of Object.entries(packages)) {
    if (
      requiresResolvedAndIntegrity(path, entry, packages) &&
      (!entry.resolved || !entry.integrity)
    ) {
      const missing = [
        !entry.resolved && "resolved",
        !entry.integrity && "integrity",
      ]
        .filter(Boolean)
        .join(" and ");
      details.push(`${path}: missing ${missing}`);
    }
  }

  for (const duplicate of detectNestedEcosystemDuplicates(packages)) {
    details.push(
      `nested duplicate ${duplicate.packageName}: ${duplicate.count} entries, versions ${duplicate.versions.join(", ") || "unknown"}`,
    );
  }

  for (const [path, entry] of Object.entries(packages)) {
    if (entry.extraneous === true) details.push(`extraneous entry: ${path}`);
  }

  return { name: "Lockfile integrity", ok: details.length === 0, details };
}
