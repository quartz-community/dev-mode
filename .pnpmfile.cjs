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

function readPackage(pkg) {
  for (const depType of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]) {
    const deps = pkg[depType];
    if (!deps) continue;

    for (const [name, version] of Object.entries(deps)) {
      // @quartz-themes/core is the plugin (repos/quartz-themes-core); the other @quartz-themes/*
      // packages are the themes themselves (tokyo-night, catppuccin, …), published data packages
      // that no repo here provides, so they resolve from npm
      const isWorkspace =
        name === "@jackyzha0/quartz" ||
        name.startsWith("@quartz-community/") ||
        name === "@quartz-themes/core";
      if (isWorkspace && typeof version === "string") {
        deps[name] = "workspace:*";
      }
    }
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
