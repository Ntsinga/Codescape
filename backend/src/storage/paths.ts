import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Scratch space only — durable state (graph, semantic tree, file contents) lives
// in Postgres. This directory is used transiently during upload/extraction and
// is deleted per-repo once processing finishes.
export const dataRoot = path.resolve(__dirname, "..", "..", "data");
export const reposRoot = path.join(dataRoot, "repos");
export const uploadsTmpDir = path.join(dataRoot, "tmp-uploads");

export function repoStorageDir(repoId: string): string {
  return path.join(reposRoot, repoId);
}

export function repoSourceDir(repoId: string): string {
  return path.join(repoStorageDir(repoId), "source");
}

export function ensureDataDirs(): void {
  fs.mkdirSync(reposRoot, { recursive: true });
  fs.mkdirSync(uploadsTmpDir, { recursive: true });
}
