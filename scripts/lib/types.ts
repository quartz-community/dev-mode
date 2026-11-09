export interface ManifestRepo {
  name?: string;
  repo: string;
  branch?: string;
}

export interface ManifestPlugin {
  name: string;
  repo?: string;
  /**
   * Not a pnpm workspace member: installed and built with its own lockfile (`npm ci`), e.g.
   * because its dependencies need a different runtime. Must also be excluded in
   * pnpm-workspace.yaml (`!repos/<name>`); `just validate` checks this.
   */
  standalone?: boolean;
}

export interface ManifestPreset {
  description?: string;
  plugins: string[];
}

export interface ManifestThemes {
  org: string;
  packages: ManifestRepo[];
}

export interface WorkspaceConfig {
  singletons?: string[];
  excludedRepos?: string[];
}

export interface Manifest {
  version: number;
  org: string;
  core: ManifestRepo;
  infrastructure: ManifestRepo[];
  themes?: ManifestThemes;
  plugins: ManifestPlugin[];
  tools?: ManifestRepo[];
  presets?: Record<string, ManifestPreset>;
  workspace?: WorkspaceConfig;
}

export interface RepoUpdateResult {
  name: string;
  path: string;
  updated: boolean;
  skipped: boolean;
}
