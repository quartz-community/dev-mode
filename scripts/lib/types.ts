export interface ManifestRepo {
  name?: string;
  repo: string;
  branch?: string;
}

export interface ManifestPlugin {
  name: string;
  repo?: string;
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
  presets?: Record<string, ManifestPreset>;
  workspace?: WorkspaceConfig;
}

export interface RepoUpdateResult {
  name: string;
  path: string;
  updated: boolean;
  skipped: boolean;
}
