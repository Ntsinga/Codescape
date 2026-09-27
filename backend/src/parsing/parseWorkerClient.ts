import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { Language, ParsedFile } from "../graph/types.js";

const WORKER_PATH = fileURLToPath(new URL("./parseWorker.js", import.meta.url));

interface Pending {
  resolve: (value: ParsedFile | null) => void;
  reject: (err: Error) => void;
}

type WorkerReply = { id: number; parsed: ParsedFile | null } | { id: number; error: string };

/**
 * Runs tree-sitter parsing in a dedicated worker thread for the lifetime of one
 * import, instead of in the main server process.
 *
 * web-tree-sitter's WASM linear memory can grow but never shrink for as long as
 * the module instance holding it stays alive (confirmed empirically: parsing a
 * single ~2KB file could jump RSS by 100MB+, with no correlation to file size —
 * that's the WASM allocator's internal fragmentation, not the content). Parsing
 * in the long-lived main process means every file ever parsed, across every
 * import the server has ever handled, permanently raises its memory floor and
 * it never comes back down — the server has strictly less headroom the longer
 * it's been running. Running it in a worker that gets terminated at the end of
 * each import means that growth is reclaimed by the OS the moment the import
 * finishes, so the main process's baseline stays flat regardless of how many
 * imports (or how many files) have been processed over its lifetime.
 */
export class ParseWorker {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private closed = false;

  constructor() {
    this.worker = new Worker(WORKER_PATH);
    this.worker.on("message", (msg: WorkerReply) => {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if ("error" in msg) entry.reject(new Error(msg.error));
      else entry.resolve(msg.parsed);
    });
    this.worker.on("error", (err) => this.rejectAll(err));
    this.worker.on("exit", (code) => {
      this.closed = true;
      if (this.pending.size) this.rejectAll(new Error(`Parser worker exited unexpectedly (code ${code})`));
    });
  }

  private rejectAll(err: Error): void {
    for (const entry of this.pending.values()) entry.reject(err);
    this.pending.clear();
  }

  parseFile(relativePath: string, language: Language, sourceText: string): Promise<ParsedFile | null> {
    if (this.closed) return Promise.reject(new Error("Parser worker is no longer available"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, relativePath, language, sourceText });
    });
  }

  async terminate(): Promise<void> {
    this.closed = true;
    this.rejectAll(new Error("Parser worker terminated"));
    await this.worker.terminate();
  }
}
