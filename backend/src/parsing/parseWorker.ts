import { parentPort } from "node:worker_threads";
import { parseFile } from "./parseFile.js";
import type { Language } from "../graph/types.js";

/**
 * Worker-thread entrypoint for tree-sitter parsing. See parseWorkerClient.ts for why
 * this runs in its own thread: web-tree-sitter's WASM memory only grows, never
 * shrinks, for the life of whatever thread holds it — isolating it here means that
 * growth dies with the worker instead of permanently raising the main server
 * process's memory floor for every import it ever handles.
 */
if (!parentPort) throw new Error("parseWorker.ts must be run as a worker_thread, not imported directly");

interface ParseRequest {
  id: number;
  relativePath: string;
  language: Language;
  sourceText: string;
}

parentPort.on("message", async (req: ParseRequest) => {
  try {
    const parsed = await parseFile(req.relativePath, req.language, req.sourceText);
    parentPort!.postMessage({ id: req.id, parsed });
  } catch (err) {
    parentPort!.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
});
