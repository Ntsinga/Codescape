import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { extractZip } from "./extractZip.js";
import { detectLanguageByExtension } from "./detectLanguage.js";
import { isSecretLike, limits } from "./ignoreRules.js";
import { repoSourceDir, repoStorageDir } from "../storage/paths.js";
import { parseFile } from "../parsing/parseFile.js";
import { buildGraph, type FileInput } from "../graph/buildGraph.js";
import { buildSemanticTree, addSubgroups, buildFileAdjacency } from "../graph/semantic.js";
import {
  insertRepo,
  insertFilesBatch,
  insertFileContentsBatch,
  insertNodesBatch,
  insertEdgesBatch,
  updateRepoStatus,
  saveSemanticTree,
  setRepoOrigin,
  clearRepoGraph,
  type RepoOrigin,
} from "../graph/queries.js";
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
 *
 * All durable output (graph, semantic tree, and file contents for the source
 * viewer/AI) is written to Postgres. The local extraction directory is scratch
 * space only and is deleted once processing finishes, since the deployed
 * environment's disk is not persistent.
 */
export async function processRepoZip(zipPath: string, displayName: string, options: ProcessOptions = {}): Promise<ProcessResult> {
  const isReplace = Boolean(options.repoId);
  const repoId = options.repoId ?? nanoid(12);

  if (isReplace) {
    await updateRepoStatus(repoId, "processing");
    await clearRepoGraph(repoId);
  } else {
    await insertRepo({
      id: repoId,
      name: displayName,
      createdAt: new Date().toISOString(),
      status: "processing",
      error: null,
      origin: { kind: null, owner: null, repo: null, branch: null },
    });
  }
  if (options.origin) await setRepoOrigin(repoId, options.origin);

  const destDir = repoSourceDir(repoId);
  try {
    await fs.mkdir(destDir, { recursive: true });
    const extractedRaw = await extractZip(zipPath, destDir);
    // GitHub/GitLab zipballs wrap everything in a single top-level folder
    // (e.g. `owner-repo-<sha>/`) — strip it so the repo root reflects real content.
    const extracted = await stripCommonPrefix(extractedRaw, destDir);

    const fileInputs: FileInput[] = [];
    let fileRecords: Array<{ id: string; repoId: string; path: string; language: string | null }> = [];
    let contentsToStore: Array<{ path: string; content: string }> = [];
    const parsedByPath = new Map<string, ParsedFile>();
    let storedBytes = 0;

    // Flush accumulated rows to Postgres and release them, so peak memory stays
    // bounded regardless of repo size (the free instance has only 512MB).
    const flush = async () => {
      if (fileRecords.length) { await insertFilesBatch(fileRecords); fileRecords = []; }
      if (contentsToStore.length) { await insertFileContentsBatch(repoId, contentsToStore); contentsToStore = []; }
    };

    for (const file of extracted) {
      const language = detectLanguageByExtension(file.relativePath);
      fileInputs.push({ relativePath: file.relativePath, language });
      fileRecords.push({ id: nanoid(10), repoId, path: file.relativePath, language: language === "unknown" ? null : language });

      const sourceText = await fs.readFile(file.absolutePath, "utf-8").catch(() => null);
      if (sourceText === null) continue;

      // Persist content for the source viewer / AI explain, skipping secrets and
      // stopping once we hit the per-repo storage cap (Neon free tier is limited).
      if (!isSecretLike(file.relativePath) && storedBytes < limits.MAX_STORED_CONTENT_BYTES) {
        contentsToStore.push({ path: file.relativePath, content: sourceText });
        storedBytes += Buffer.byteLength(sourceText, "utf-8");
      }

      if (language !== "unknown") {
        const parsed = await parseFile(file.relativePath, language, sourceText);
        if (parsed) parsedByPath.set(file.relativePath, parsed);
      }

      // Periodically flush so we never hold the whole repo's contents at once.
      if (fileRecords.length >= 50 || contentsToStore.length >= 40) await flush();
    }

    await flush();

    const { nodes, edges } = buildGraph(repoId, displayName, fileInputs, parsedByPath);
    await insertNodesBatch(nodes);
    await insertEdgesBatch(edges);

    // Deterministic semantic decomposition, stored immediately (no API key / latency
    // cost). AI enrichment of names/summaries happens on demand via /decompose.
    const semanticTree = addSubgroups(buildSemanticTree(displayName, nodes), buildFileAdjacency(nodes, edges));
    await saveSemanticTree(repoId, semanticTree, false);

    await updateRepoStatus(repoId, "ready");

    const symbolCount = nodes.filter((n) => n.type === "Class" || n.type === "Interface" || n.type === "Function").length;
    return { repoId, fileCount: extracted.length, symbolCount };
  } catch (err) {
    await updateRepoStatus(repoId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await fs.unlink(zipPath).catch(() => undefined);
    // Postgres now holds everything needed to serve this repo; the local copy was
    // only ever scratch space for extraction + parsing.
    await fs.rm(repoStorageDir(repoId), { recursive: true, force: true }).catch(() => undefined);
  }
}
