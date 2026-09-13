import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { extractZip } from "./extractZip.js";
import { detectLanguageByExtension } from "./detectLanguage.js";
import { repoSourceDir, repoStorageDir } from "../storage/paths.js";
import { parseFile } from "../parsing/parseFile.js";
import { buildGraph, type FileInput } from "../graph/buildGraph.js";
import { buildSemanticTree, addSubgroups, buildFileAdjacency } from "../graph/semantic.js";
import { insertRepo, insertFile, insertNodesBatch, insertEdgesBatch, updateRepoStatus, saveSemanticTree, setRepoOrigin, clearRepoGraph, type RepoOrigin } from "../graph/queries.js";
import type { ParsedFile } from "../graph/types.js";

export interface ProcessResult {
  repoId: string;
  fileCount: number;
  symbolCount: number;
}

export interface ProcessOptions {
  /** When set, re-process into this existing repo id (clears its prior data) instead of creating a new one. */
  repoId?: string;
  origin?: RepoOrigin;
}

/**
 * If every extracted file shares one top-level folder (as GitHub/GitLab zipballs
 * always do), rebase both the in-memory paths and the on-disk layout so the repo
 * root reflects real content instead of a single wrapper node. Also updates the
 * absolute paths on the returned records so subsequent reads target the new layout.
 */
async function stripCommonPrefix<T extends { relativePath: string; absolutePath: string }>(files: T[], destDir: string): Promise<T[]> {
  if (files.length === 0) return files;
  const firstSegment = files[0].relativePath.split("/")[0];
  if (!firstSegment) return files;
  const allShare = files.every((f) => {
    const seg = f.relativePath.split("/")[0];
    return seg === firstSegment && f.relativePath.length > firstSegment.length;
  });
  if (!allShare) return files;

  const wrapperDir = path.join(destDir, firstSegment);
  const stagingDir = path.join(destDir, `.__unwrap-${nanoid(6)}`);
  await fs.rename(wrapperDir, stagingDir);
  const entries = await fs.readdir(stagingDir);
  for (const entry of entries) {
    await fs.rename(path.join(stagingDir, entry), path.join(destDir, entry));
  }
  await fs.rmdir(stagingDir);

  const prefix = `${firstSegment}/`;
  return files.map((f) => ({
    ...f,
    relativePath: f.relativePath.slice(prefix.length),
    absolutePath: path.join(destDir, f.relativePath.slice(prefix.length)),
  }));
}

/**
 * Runs the full deterministic pipeline for one uploaded zip: secure extraction,
 * language detection, tree-sitter parsing, and common-graph construction —
 * matching the "deterministic analysis first" principle from the product spec.
 */
export async function processRepoZip(zipPath: string, displayName: string, options: ProcessOptions = {}): Promise<ProcessResult> {
  const isReplace = Boolean(options.repoId);
  const repoId = options.repoId ?? nanoid(12);

  if (isReplace) {
    updateRepoStatus(repoId, "processing");
    clearRepoGraph(repoId);
    await fs.rm(repoStorageDir(repoId), { recursive: true, force: true }).catch(() => undefined);
  } else {
    insertRepo({ id: repoId, name: displayName, createdAt: new Date().toISOString(), status: "processing", error: null, origin: { kind: null, owner: null, repo: null, branch: null } });
  }
  if (options.origin) setRepoOrigin(repoId, options.origin);

  try {
    const destDir = repoSourceDir(repoId);
    await fs.mkdir(destDir, { recursive: true });
    const extractedRaw = await extractZip(zipPath, destDir);
    // GitHub/GitLab zipballs wrap everything in a single top-level folder
    // (e.g. `owner-repo-<sha>/`) — strip it so the repo root reflects real content.
    const extracted = await stripCommonPrefix(extractedRaw, destDir);

    const fileInputs: FileInput[] = [];
    const parsedByPath = new Map<string, ParsedFile>();

    for (const file of extracted) {
      const language = detectLanguageByExtension(file.relativePath);
      fileInputs.push({ relativePath: file.relativePath, language });
      insertFile(nanoid(10), repoId, file.relativePath, language === "unknown" ? null : language);

      if (language === "unknown") continue;
      const sourceText = await fs.readFile(file.absolutePath, "utf-8").catch(() => null);
      if (sourceText === null) continue;
      const parsed = await parseFile(file.relativePath, language, sourceText);
      if (parsed) parsedByPath.set(file.relativePath, parsed);
    }

    const { nodes, edges } = buildGraph(repoId, displayName, fileInputs, parsedByPath);
    insertNodesBatch(nodes);
    insertEdgesBatch(edges);

    // Deterministic semantic decomposition, stored immediately (no API key / latency
    // cost). AI enrichment of names/summaries happens on demand via /decompose.
    const semanticTree = addSubgroups(buildSemanticTree(displayName, nodes), buildFileAdjacency(nodes, edges));
    saveSemanticTree(repoId, semanticTree, false);

    updateRepoStatus(repoId, "ready");

    const symbolCount = nodes.filter((n) => n.type === "Class" || n.type === "Interface" || n.type === "Function").length;
    return { repoId, fileCount: extracted.length, symbolCount };
  } catch (err) {
    updateRepoStatus(repoId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await fs.unlink(zipPath).catch(() => undefined);
  }
}
