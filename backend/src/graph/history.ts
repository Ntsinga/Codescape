import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { nanoid } from "nanoid";
import { getPool } from "./db.js";
import { uploadsTmpDir } from "../storage/paths.js";

/**
 * Git history for the 3D map's time dimension. Only GitHub imports have history
 * (a zip upload is a snapshot), so this clones the repo blobless — commits and
 * trees only, no file contents — and reads `git log --name-only` as a stream.
 * Git runs as its own process, so the Node heap stays small.
 */

export interface FileHistory {
  firstSeen: string;
  lastModified: string;
  commits: number;
  /** Commits per month, keyed "YYYY-MM". */
  monthly: Record<string, number>;
}

export interface HistoryResult {
  available: boolean;
  reason?: string;
  collectedAt?: string;
  range?: { start: string; end: string };
  files: Record<string, FileHistory>;
}

const inFlight = new Map<string, Promise<void>>();

/** Collects and stores history; failures are recorded as a reason, never thrown to the import. */
export function collectHistoryInBackground(repoId: string, owner: string, repo: string, branch: string | null, token: string): void {
  if (inFlight.has(repoId)) return;
  const run = collectHistory(repoId, owner, repo, branch, token)
    .catch(async (err) => {
      const reason = err instanceof Error ? err.message.split(token).join("***") : "History collection failed";
      console.warn(`[history] ${repoId}: ${reason}`);
      await saveHistoryStatus(repoId, reason).catch(() => undefined);
    })
    .finally(() => inFlight.delete(repoId));
  inFlight.set(repoId, run);
}

export function isCollectingHistory(repoId: string): boolean {
  return inFlight.has(repoId);
}

async function collectHistory(repoId: string, owner: string, repo: string, branch: string | null, token: string): Promise<void> {
  const dir = path.join(uploadsTmpDir, `history-${nanoid(8)}`);
  const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  try {
    const cloneArgs = ["clone", "--bare", "--filter=blob:none", "--single-branch", "--quiet"];
    if (branch && branch !== "HEAD") cloneArgs.push("--branch", branch);
    await run("git", [...cloneArgs, url, dir]);

    const files = new Map<string, FileHistory>();
    let commitDate = "";
    await streamLines("git", ["--git-dir", dir, "log", "--no-renames", "--name-only", "--format=__C__%aI"], (line) => {
      if (line.startsWith("__C__")) {
        commitDate = line.slice(5);
        return;
      }
      const p = line.trim();
      if (!p || !commitDate) return;
      const month = commitDate.slice(0, 7);
      const h = files.get(p);
      if (!h) {
        files.set(p, { firstSeen: commitDate, lastModified: commitDate, commits: 1, monthly: { [month]: 1 } });
      } else {
        // git log is newest-first, so each older commit pushes firstSeen back.
        h.firstSeen = commitDate;
        h.commits++;
        h.monthly[month] = (h.monthly[month] ?? 0) + 1;
      }
    });
    await saveHistory(repoId, files);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (err: NodeJS.ErrnoException) => reject(new Error(err.code === "ENOENT" ? "git is not installed on the server" : err.message)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} failed: ${stderr.trim().slice(0, 300)}`))));
  });
}

function streamLines(cmd: string, args: string[], onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    readline.createInterface({ input: child.stdout }).on("line", onLine);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git log failed: ${stderr.trim().slice(0, 300)}`))));
  });
}

async function saveHistory(repoId: string, files: Map<string, FileHistory>): Promise<void> {
  const payload = JSON.stringify(Object.fromEntries(files));
  await getPool().query(
    `INSERT INTO repo_history (repo_id, collected_at, files_json, error) VALUES ($1, $2, $3, NULL)
     ON CONFLICT (repo_id) DO UPDATE SET collected_at = EXCLUDED.collected_at, files_json = EXCLUDED.files_json, error = NULL`,
    [repoId, new Date().toISOString(), payload]
  );
}

async function saveHistoryStatus(repoId: string, error: string): Promise<void> {
  await getPool().query(
    `INSERT INTO repo_history (repo_id, collected_at, files_json, error) VALUES ($1, $2, NULL, $3)
     ON CONFLICT (repo_id) DO UPDATE SET collected_at = EXCLUDED.collected_at, error = EXCLUDED.error`,
    [repoId, new Date().toISOString(), error]
  );
}

export async function getHistory(repoId: string): Promise<HistoryResult | null> {
  const { rows } = await getPool().query(`SELECT collected_at, files_json, error FROM repo_history WHERE repo_id = $1`, [repoId]);
  if (!rows[0]) return null;
  const { collected_at, files_json, error } = rows[0] as { collected_at: string; files_json: string | null; error: string | null };
  if (!files_json) return { available: false, reason: error ?? "History not collected", files: {} };
  const files = JSON.parse(files_json) as Record<string, FileHistory>;
  let start = "";
  let end = "";
  for (const h of Object.values(files)) {
    if (!start || h.firstSeen < start) start = h.firstSeen;
    if (!end || h.lastModified > end) end = h.lastModified;
  }
  return { available: true, collectedAt: collected_at, range: { start, end }, files, ...(error ? { reason: error } : {}) };
}
