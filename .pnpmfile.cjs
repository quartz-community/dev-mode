/**
 * pnpm readPackage hook — rewrites dependency specifiers for known workspace
 * packages to `workspace:*` so pnpm resolves them from local clones in repos/.
 *
 * Covers all specifier formats (github:, semver ranges, etc.) and all
 * dependency types (dependencies, devDependencies, peerDependencies).
 *
 * Only packages in the explicit allowlist are rewritten. Adding a new
 * infrastructure package here requires also adding it to the overrides
 * in pnpm-workspace.yaml.
 */

const WORKSPACE_PACKAGES = new Set([
  "@quartz-community/types",
  "@quartz-community/utils",
  "@quartz-community/runtime",
  "@jackyzha0/quartz",
]);

function readPackage(pkg) {
  for (const depType of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]) {
    const deps = pkg[depType];
    if (!deps) continue;

    for (const [name, version] of Object.entries(deps)) {
      if (WORKSPACE_PACKAGES.has(name) && typeof version === "string") {
        deps[name] = "workspace:*";
      }
    }
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
