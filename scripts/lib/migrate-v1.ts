export const TARGET_VERSION = "1.0.0";
export const TARGET_RANGE = `^${TARGET_VERSION}`;

export const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

export interface MigrationPackageJson {
  [key: string]: unknown;
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface RangeRewrite {
  section: DependencySection;
  dependency: string;
  from: string;
  to: string;
}

export interface RangeRewriteResult {
  packageJson: MigrationPackageJson;
  rewrites: RangeRewrite[];
}

export class ReleaseCycleError extends Error {
  readonly packages: string[];

  constructor(packages: string[]) {
    const sorted = [...packages].sort();
    super(`Dependency cycle detected: ${sorted.join(", ")}`);
    this.name = "ReleaseCycleError";
    this.packages = sorted;
  }
}

export function rewriteInternalRanges(
  input: MigrationPackageJson,
): RangeRewriteResult {
  const packageJson = structuredClone(input);
  const rewrites: RangeRewrite[] = [];

  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson[section];
    if (!dependencies) continue;

    for (const [dependency, range] of Object.entries(dependencies)) {
      if (!dependency.startsWith("@quartz-community/")) continue;
      if (range === TARGET_RANGE) continue;
      dependencies[dependency] = TARGET_RANGE;
      rewrites.push({
        section,
        dependency,
        from: range,
        to: TARGET_RANGE,
      });
    }
  }

  return { packageJson, rewrites };
}

function findCyclicComponent(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string[] | undefined {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclicComponents: string[][] = [];

  const visit = (node: string): void => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!graph.has(dependency)) continue;
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, indices.get(dependency)!),
        );
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }

    const hasSelfLoop =
      component.length === 1 && graph.get(component[0])?.has(component[0]);
    if (component.length > 1 || hasSelfLoop) {
      cyclicComponents.push(component.sort());
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) visit(node);
  }

  return cyclicComponents.sort((left, right) =>
    left.join("\0").localeCompare(right.join("\0")),
  )[0];
}

export function computeReleaseWaves(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  const cycle = findCyclicComponent(graph);
  if (cycle) throw new ReleaseCycleError(cycle);

  const remaining = new Set(graph.keys());
  const released = new Set<string>();
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const wave = [...remaining]
      .filter((name) =>
        [...(graph.get(name) ?? [])].every(
          (dependency) => !graph.has(dependency) || released.has(dependency),
        ),
      )
      .sort();

    if (wave.length === 0) {
      throw new Error("Dependency graph could not be topologically sorted");
    }

    waves.push(wave);
    for (const name of wave) {
      remaining.delete(name);
      released.add(name);
    }
  }

  return waves;
}
