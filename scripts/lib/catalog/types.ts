/**
 * Shared types for the plugin catalog / atlas (`scripts/catalog.ts`).
 */

export type PackageKind =
  "core" | "infrastructure" | "plugin" | "theme" | "tool" | "unknown";

/** Pipeline phase a piece of code runs in. */
export type Phase =
  | "parse"
  | "textTransform"
  | "markdownPlugins"
  | "htmlPlugins"
  | "externalResources"
  | "shouldPublish"
  | "emit"
  | "partialEmit"
  | "getQuartzComponents"
  | "match"
  | "generate"
  | "body"
  | "treeTransforms"
  | "component"
  | "unknown";

export interface SourceLoc {
  file: string; // path relative to the repo dir
  line: number;
}

export interface DataAccess extends SourceLoc {
  key: string;
  mode: "read" | "write";
  phase: Phase;
}

export interface DataMapDecl extends SourceLoc {
  key: string;
  type: string;
  optional: boolean;
}

export interface FrontmatterAccess extends SourceLoc {
  field: string;
  mode: "read" | "write";
}

export interface EmittedOutput extends SourceLoc {
  /** Best-effort rendering of `slug + ext`, e.g. `sitemap.xml` or `<fp>.json`. */
  path: string;
}

export interface ClientFacts {
  /** Files that are bundled for the browser (`*.inline.ts`). */
  scripts: string[];
  /** `document|window.addEventListener("x")` → `document:x`. */
  listens: string[];
  /** `new CustomEvent("x")` names. */
  dispatches: string[];
  usesAddCleanup: boolean;
  localStorage: string[];
  sessionStorage: string[];
  fetches: string[];
}

export interface DomFacts {
  /** Classes the package renders (TSX `class=`, hast `className`, `classList.add`). */
  renderedClasses: string[];
  renderedIds: string[];
  /** Classes referenced in its CSS/SCSS selectors. */
  styledClasses: string[];
  styledIds: string[];
  /** Classes / ids its scripts query (`querySelector(".x")`, `getElementById`). */
  scriptedClasses: string[];
  scriptedIds: string[];
  /** Stylesheets (relative paths). */
  stylesheets: string[];
}

export interface QuartzComponentManifest {
  displayName?: string;
  defaultPosition?: string;
  defaultPriority?: number;
}

export interface QuartzManifestSummary {
  name?: string;
  displayName?: string;
  category: string[];
  defaultOrder?: number;
  defaultEnabled?: boolean;
  defaultOptionKeys: string[];
  optionSchema?: Record<string, unknown>;
  components: Record<string, QuartzComponentManifest>;
  frames: Record<string, unknown>;
  dependencies: string[];
  requires?: unknown;
  conflicts?: unknown;
  requiresInstall?: unknown;
}

export interface WorkspaceDep {
  name: string; // npm name
  dir: string;
  type: "dependencies" | "peerDependencies" | "devDependencies";
}

export interface PackageEntry {
  dir: string;
  npmName: string;
  kind: PackageKind;
  version?: string;
  description?: string;
  readme?: string;
  quartz?: QuartzManifestSummary;
  workspaceDeps: WorkspaceDep[];
  dependents: string[]; // dirs that depend on this one (direct)
  hooks: string[];
  exports: string[];
  dataMap: DataMapDecl[];
  dataAccess: DataAccess[];
  frontmatter: FrontmatterAccess[];
  provides: string[]; // keys written (+ DataMap-declared for non-types packages)
  consumes: string[]; // keys read but not written by this package
  emits: EmittedOutput[];
  client: ClientFacts;
  dom: DomFacts;
  testFiles: number;
  sourceFiles: number;
  /** Consistency notes (template leftovers, hooks vs declared category, ...). */
  warnings: string[];
}

export interface DataKeyFlow {
  key: string;
  type?: string;
  declaredBy: string[];
  producers: { pkg: string; phases: Phase[] }[];
  consumers: { pkg: string; phases: Phase[] }[];
  status: "ok" | "consumed-never-produced" | "produced-never-consumed";
}

export interface PipelineStep {
  pkg: string;
  order: number;
  phases: Phase[];
  writes: Record<string, string[]>; // phase → keys
  reads: Record<string, string[]>;
}

export interface OrderHazard {
  consumer: string;
  consumerPhase: Phase;
  consumerOrder: number;
  key: string;
  producer: string;
  producerPhase: Phase;
  producerOrder: number;
  message: string;
}

export interface Catalog {
  generatedAt: string;
  durationMs: number;
  packages: PackageEntry[];
  dataFlow: DataKeyFlow[];
  pipeline: {
    transformers: PipelineStep[];
    filters: PipelineStep[];
    emitters: PipelineStep[];
    pageTypes: PipelineStep[];
  };
  hazards: OrderHazard[];
  /** Keys written by more than one transformer: the last writer (highest order/phase) wins. */
  multiWriters: {
    key: string;
    writers: { pkg: string; phase: Phase; order: number }[];
  }[];
  fixtures: FixtureInfo[];
  specs: SpecInfo[];
}

export interface FixtureInfo {
  name: string;
  kind: "fixture" | "repro";
  dir: string; // relative to workspace root
  /** Enabled plugin sources resolved to repo dirs where possible. */
  plugins: string[];
}

export interface SpecInfo {
  file: string; // relative to workspace root
  /** Lower-cased content is kept out of the JSON; these are the matched tokens. */
  fixtures: string[];
  text?: string;
}
