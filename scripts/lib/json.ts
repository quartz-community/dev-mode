import { readFileSync } from "node:fs";

export function safeReadJson<T>(path: string): T {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (error) {
    throw new Error(
      `Cannot read file: ${path} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
