import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { extractZip } from "./extractZip.js";
import { detectLanguageByExtension } from "./detectLanguage.js";
import { isSecretLike, limits } from "./ignoreRules.js";
import { repoSourceDir, repoStorageDir } from "../storage/paths.js";
import { ParseWorker } from "../parsing/parseWorkerClient.js";
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
let queueTail: Promise<void> = Promise.resolve();

/** Bail out of an in-flight import before it drags the whole process past the container's
 * memory limit — a graceful "failed" status for this one repo beats an OOM kill that takes
 * down every other request the process is currently serving. */
const MAX_INGEST_RSS_BYTES = Number(process.env.INGEST_MAX_RSS_BYTES) || 420 * 1024 * 1024; // headroom under the 512MB instance

export function processRepoZip(zipPath: string, displayName: string, options: ProcessOptions = {}): Promise<ProcessResult> {
  // Serialize all imports/uploads: this runs as a single Node process (WEB_CONCURRENCY=1)
  // on a 512MB instance, and each pipeline run (extraction, parsing, batched inserts) has
  // its own peak memory cost. Two runs racing in the same heap — e.g. a duplicate request
  // from a client retry — can OOM-kill the whole process even when either alone would fit.
  // Queuing keeps that peak to one pipeline at a time regardless of how many requests land.
  const run = queueTail.then(() => processRepoZipInner(zipPath, displayName, options));
  queueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// TEMPORARY diagnostics: pinpoint exactly which pipeline stage spikes memory on a
// crashing import. Cheap (one process.memoryUsage() call + a console.log), and
// gated so it can't spam logs on a large repo. Remove once the real cause is found.
function logMem(stage: string): void {
  const m = process.memoryUsage();
  console.log(`[mem] ${stage}: rss=${(m.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(m.heapUsed / 1024 / 1024).toFixed(1)}MB external=${(m.external / 1024 / 1024).toFixed(1)}MB arrayBuffers=${(m.arrayBuffers / 1024 / 1024).toFixed(1)}MB`);
}

function assertMemoryBudget(): void {
  const rss = process.memoryUsage().rss;
  if (rss > MAX_INGEST_RSS_BYTES) {
    throw new Error(
      `Repository is too large to process within the available memory (using ~${Math.round(rss / 1024 / 1024)}MB of a ~${Math.round(MAX_INGEST_RSS_BYTES / 1024 / 1024)}MB budget). Try a smaller repo, or a subdirectory of it.`
    );
  }
}

async function processRepoZipInner(zipPath: string, displayName: string, options: ProcessOptions = {}): Promise<ProcessResult> {
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
  // Parsing runs in its own worker thread, terminated at the end of this import, so
  // web-tree-sitter's WASM memory (which only grows, never shrinks) dies with it instead
  // of permanently raising the main server process's memory floor. See parseWorkerClient.ts.
  const parseWorker = new ParseWorker();
  try {
    logMem(`start (repo=${repoId})`);
    await fs.mkdir(destDir, { recursive: true });
    const extractedRaw = await extractZip(zipPath, destDir);
    logMem(`after extractZip (${extractedRaw.length} files)`);
    // GitHub/GitLab zipballs wrap everything in a single top-level folder
    // (e.g. `owner-repo-<sha>/`) — strip it so the repo root reflects real content.
    const extracted = await stripCommonPrefix(extractedRaw, destDir);
    logMem("after stripCommonPrefix");

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

    let fileIndex = 0;
    for (const file of extracted) {
      fileIndex += 1;
      const language = detectLanguageByExtension(file.relativePath);
      fileInputs.push({ relativePath: file.relativePath, language });
      fileRecords.push({ id: nanoid(10), repoId, path: file.relativePath, language: language === "unknown" ? null : language });

      const sourceText = await fs.readFile(file.absolutePath, "utf-8").catch(() => null);
      if (sourceText === null) continue;
      logMem(`file ${fileIndex}/${extracted.length} ${file.relativePath} (${sourceText.length} chars, lang=${language})`);

      // A NUL byte means the file is binary (or wrong-encoded) — Postgres TEXT
      // can't hold 0x00, and it isn't real source, so skip storing and parsing it.
      if (sourceText.indexOf(String.fromCharCode(0)) !== -1) continue;

      // Persist content for the source viewer / AI explain, skipping secrets and
      // stopping once we hit the per-repo storage cap (Neon free tier is limited).
      if (!isSecretLike(file.relativePath) && storedBytes < limits.MAX_STORED_CONTENT_BYTES) {
        contentsToStore.push({ path: file.relativePath, content: sourceText });
        storedBytes += Buffer.byteLength(sourceText, "utf-8");
      }

      if (language !== "unknown") {
        const parsed = await parseWorker.parseFile(file.relativePath, language, sourceText);
        if (parsed) parsedByPath.set(file.relativePath, parsed);
      }

      // Check the memory budget after every file, not just at flush time: tree-sitter's
      // WASM arena can only grow, never shrink, and a single file's parse has been observed
      // to jump RSS by 100MB+ regardless of that file's own size. Checking only every 40-50
      // files left gaps wide enough for a real OOM kill to land between checks.
      assertMemoryBudget();

      // Periodically flush so we never hold the whole repo's contents at once.
      if (fileRecords.length >= 50 || contentsToStore.length >= 40) await flush();
    }

    await flush();
    logMem("after file loop + final flush");

    const { nodes, edges } = buildGraph(repoId, displayName, fileInputs, parsedByPath);
    logMem(`after buildGraph (${nodes.length} nodes, ${edges.length} edges)`);
    await insertNodesBatch(nodes);
    await insertEdgesBatch(edges);
    logMem("after insertNodesBatch/insertEdgesBatch");

    // Deterministic semantic decomposition, stored immediately (no API key / latency
    // cost). AI enrichment of names/summaries happens on demand via /decompose.
    const semanticTree = addSubgroups(buildSemanticTree(displayName, nodes), buildFileAdjacency(nodes, edges));
    await saveSemanticTree(repoId, semanticTree, false);
    logMem("after semantic tree");

    await updateRepoStatus(repoId, "ready");

    const symbolCount = nodes.filter((n) => n.type === "Class" || n.type === "Interface" || n.type === "Function").length;
    return { repoId, fileCount: extracted.length, symbolCount };
  } catch (err) {
    await updateRepoStatus(repoId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    // Reclaim the worker's WASM memory the moment this import ends, success or not.
    await parseWorker.terminate().catch(() => undefined);
    await fs.unlink(zipPath).catch(() => undefined);
    // Postgres now holds everything needed to serve this repo; the local copy was
    // only ever scratch space for extraction + parsing.
    await fs.rm(repoStorageDir(repoId), { recursive: true, force: true }).catch(() => undefined);
  }
}
