import ts from "typescript";
import type { PeerConsistencyPackage } from "./peer-consistency.js";

export interface BuildTimePeerPackage extends PeerConsistencyPackage {
  sourceFiles: string[];
}

export interface BuildTimePeerCheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

function isEcosystemPackage(name: string): boolean {
  return (
    name.startsWith("@quartz-community/") || name.startsWith("@quartz-themes/")
  );
}

export function collectModuleSpecifiers(sourceFiles: string[]): Set<string> {
  const specifiers = new Set<string>();

  for (const source of sourceFiles) {
    const sourceFile = ts.createSourceFile(
      "source.tsx",
      source,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        specifiers.add(node.moduleSpecifier.text);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        specifiers.add(node.moduleReference.expression.text);
      } else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        specifiers.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return specifiers;
}

function importsPeer(specifiers: Set<string>, peerName: string): boolean {
  return [...specifiers].some(
    (specifier) =>
      specifier === peerName || specifier.startsWith(`${peerName}/`),
  );
}

export function checkBuildTimePeerAvailability(
  packages: BuildTimePeerPackage[],
): BuildTimePeerCheckResult {
  const details: string[] = [];
  let ok = true;

  for (const pkg of packages) {
    if (!pkg.name?.startsWith("@quartz-")) continue;
    const available = { ...pkg.dependencies, ...pkg.devDependencies };
    const specifiers = collectModuleSpecifiers(pkg.sourceFiles);
    for (const [peerName, peerRange] of Object.entries(
      pkg.peerDependencies ?? {},
    )) {
      if (
        isEcosystemPackage(peerName) ||
        peerName === "@jackyzha0/quartz" ||
        available[peerName]
      ) {
        continue;
      }

      const optional = pkg.peerDependenciesMeta?.[peerName]?.optional === true;
      const imported = importsPeer(specifiers, peerName);
      if (imported) {
        const detail = `${pkg.name}@${pkg.version ?? "unknown"} peer ${peerName} ${peerRange} is imported by src/ but missing from devDependencies; source builds fail under legacy-peer-deps [${optional ? "optional" : "required"}]`;
        if (!optional) ok = false;
        details.push(optional ? `warning: ${detail}` : detail);
      } else {
        details.push(
          `warning: ${pkg.name}@${pkg.version ?? "unknown"} peer ${peerName} ${peerRange} is declared but not imported by src/ and missing from devDependencies [${optional ? "optional" : "required"}]`,
        );
      }
    }
  }

  return { name: "Build-time peer availability", ok, details };
}
