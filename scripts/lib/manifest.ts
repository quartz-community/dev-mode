import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import type { Manifest } from "./types.js";

const ROOT = resolve(import.meta.dirname, "../..");
const MANIFEST_PATH = join(ROOT, "dev.yaml");

export function readManifest(manifestPath?: string): Manifest {
  const raw = readFileSync(manifestPath ?? MANIFEST_PATH, "utf-8");
  return parse(raw) as Manifest;
}
