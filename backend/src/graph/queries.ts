import { getPool } from "./db.js";
import type { EdgeType, GraphEdge, GraphNode, NodeType } from "./types.js";

export interface RepoOrigin {
  kind: "zip" | "github" | null;
  owner: string | null;
  repo: string | null;
  branch: string | null;
}

export interface RepoRecord {
  id: string;
  name: string;
  createdAt: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  origin: RepoOrigin;
}

export async function insertRepo(repo: RepoRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO repos (id, name, created_at, status, error, origin_kind, origin_owner, origin_repo, origin_branch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [repo.id, repo.name, repo.createdAt, repo.status, repo.error, repo.origin.kind, repo.origin.owner, repo.origin.repo, repo.origin.branch]
  );
}

export async function updateRepoStatus(id: string, status: RepoRecord["status"], error?: string): Promise<void> {
  await getPool().query(`UPDATE repos SET status = $1, error = $2 WHERE id = $3`, [status, error ?? null, id]);
}

function rowToRepo(row: any): RepoRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    status: row.status,
    error: row.error,
    origin: { kind: row.origin_kind ?? null, owner: row.origin_owner ?? null, repo: row.origin_repo ?? null, branch: row.origin_branch ?? null },
  };
}

export async function getRepo(id: string): Promise<RepoRecord | undefined> {
  const { rows } = await getPool().query(`SELECT * FROM repos WHERE id = $1`, [id]);
  return rows[0] ? rowToRepo(rows[0]) : undefined;
}

export async function listRepos(): Promise<RepoRecord[]> {
  const { rows } = await getPool().query(`SELECT * FROM repos ORDER BY created_at DESC`);
  return rows.map(rowToRepo);
}

export async function setRepoOrigin(id: string, origin: RepoOrigin): Promise<void> {
  await getPool().query(`UPDATE repos SET origin_kind = $1, origin_owner = $2, origin_repo = $3, origin_branch = $4 WHERE id = $5`, [
    origin.kind,
    origin.owner,
    origin.repo,
    origin.branch,
    id,
  ]);
}

/** Clears a repo's derived graph + semantic data (for in-place re-import). */
export async function clearRepoGraph(id: string): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM nodes WHERE repo_id = $1`, [id]);
    await client.query(`DELETE FROM edges WHERE repo_id = $1`, [id]);
    await client.query(`DELETE FROM files WHERE repo_id = $1`, [id]);
    await client.query(`DELETE FROM file_contents WHERE repo_id = $1`, [id]);
    await client.query(`UPDATE repos SET semantic_json = NULL, semantic_enriched = FALSE WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0] ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getPool().query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [key, value]);
}

// ---- GitHub OAuth (persisted so they survive backend restarts) ----

export async function savePendingOAuthState(state: string): Promise<void> {
  await getPool().query(`INSERT INTO github_oauth_state (state, created_at) VALUES ($1, $2) ON CONFLICT (state) DO NOTHING`, [state, new Date().toISOString()]);
}

/** Returns the state's creation time and deletes it (single-use); null if unknown. */
export async function consumePendingOAuthState(state: string): Promise<Date | null> {
  const { rows } = await getPool().query(`DELETE FROM github_oauth_state WHERE state = $1 RETURNING created_at`, [state]);
  return rows[0] ? new Date(rows[0].created_at) : null;
}

export async function saveGithubSession(connection: string, token: string): Promise<void> {
  await getPool().query(`INSERT INTO github_sessions (connection, token, created_at) VALUES ($1, $2, $3) ON CONFLICT (connection) DO UPDATE SET token = excluded.token`, [
    connection,
    token,
    new Date().toISOString(),
  ]);
}

export async function getGithubSessionToken(connection: string): Promise<string | null> {
  if (!connection) return null;
  const { rows } = await getPool().query(`SELECT token FROM github_sessions WHERE connection = $1`, [connection]);
  return rows[0] ? rows[0].token : null;
}

export async function saveSemanticTree(repoId: string, tree: unknown, enriched: boolean): Promise<void> {
  await getPool().query(`UPDATE repos SET semantic_json = $1, semantic_enriched = $2 WHERE id = $3`, [JSON.stringify(tree), enriched, repoId]);
}

export async function getSemanticTree(repoId: string): Promise<{ tree: any; enriched: boolean } | undefined> {
  const { rows } = await getPool().query(`SELECT semantic_json, semantic_enriched FROM repos WHERE id = $1`, [repoId]);
  const row = rows[0];
  if (!row || !row.semantic_json) return undefined;
  try {
    return { tree: JSON.parse(row.semantic_json), enriched: Boolean(row.semantic_enriched) };
  } catch {
    return undefined;
  }
}

export async function insertFile(id: string, repoId: string, filePath: string, language: string | null): Promise<void> {
  await getPool().query(`INSERT INTO files (id, repo_id, path, language) VALUES ($1, $2, $3, $4)`, [id, repoId, filePath, language]);
}

export async function insertFilesBatch(files: Array<{ id: string; repoId: string; path: string; language: string | null }>): Promise<void> {
  if (files.length === 0) return;
  await batchInsert(
    "files",
    ["id", "repo_id", "path", "language"],
    files.map((f) => [f.id, f.repoId, f.path, f.language])
  );
}

/** Content for the source viewer / AI snippets — the persistent replacement for reading local disk. */
export async function insertFileContentsBatch(repoId: string, files: Array<{ path: string; content: string }>): Promise<void> {
  if (files.length === 0) return;
  await batchInsert(
    "file_contents",
    ["repo_id", "path", "content"],
    files.map((f) => [repoId, f.path, f.content])
  );
}

export async function getFileContent(repoId: string, filePath: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT content FROM file_contents WHERE repo_id = $1 AND path = $2`, [repoId, filePath]);
  return rows[0] ? rows[0].content : null;
}

export async function listFileContentPaths(repoId: string, pathSuffix: RegExp): Promise<Array<{ path: string; content: string }>> {
  const { rows } = await getPool().query(`SELECT path, content FROM file_contents WHERE repo_id = $1`, [repoId]);
  return rows.filter((r: any) => pathSuffix.test(r.path));
}

/** Generic multi-row INSERT batching (Postgres has no prepared-statement transaction helper like better-sqlite3's). */
async function batchInsert(table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const db = getPool();
  const CHUNK = 500; // stay well under Postgres' ~65535 parameter limit
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((row, r) => {
      const placeholders = row.map((_, c) => `$${r * columns.length + c + 1}`);
      values.push(...row);
      return `(${placeholders.join(", ")})`;
    });
    await db.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, values);
  }
}

export async function insertNodesBatch(nodes: GraphNode[]): Promise<void> {
  if (nodes.length === 0) return;
  await batchInsert(
    "nodes",
    ["id", "repo_id", "type", "name", "parent_id", "file_id", "file_path", "start_line", "end_line", "language", "metadata"],
    nodes.map((n) => [n.id, n.repoId, n.type, n.name, n.parentId, n.fileId, n.filePath, n.startLine, n.endLine, n.language, JSON.stringify(n.metadata ?? {})])
  );
}

export async function insertEdgesBatch(edges: GraphEdge[]): Promise<void> {
  if (edges.length === 0) return;
  await batchInsert(
    "edges",
    ["id", "repo_id", "from_node_id", "to_node_id", "type", "confidence", "evidence"],
    edges.map((e) => [e.id, e.repoId, e.fromNodeId, e.toNodeId, e.type, e.confidence, JSON.stringify(e.evidence)])
  );
}

function rowToNode(row: any): GraphNode {
  return {
    id: row.id,
    repoId: row.repo_id,
    type: row.type,
    name: row.name,
    parentId: row.parent_id,
    fileId: row.file_id,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    language: row.language,
    metadata: JSON.parse(row.metadata ?? "{}"),
  };
}

function rowToEdge(row: any): GraphEdge {
  return {
    id: row.id,
    repoId: row.repo_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    type: row.type,
    confidence: row.confidence,
    evidence: JSON.parse(row.evidence ?? "[]"),
  };
}

export async function getNode(nodeId: string): Promise<GraphNode | undefined> {
  const { rows } = await getPool().query(`SELECT * FROM nodes WHERE id = $1`, [nodeId]);
  return rows[0] ? rowToNode(rows[0]) : undefined;
}

export async function getChildren(parentId: string | null, repoId: string): Promise<GraphNode[]> {
  const { rows } =
    parentId === null
      ? await getPool().query(`SELECT * FROM nodes WHERE repo_id = $1 AND parent_id IS NULL`, [repoId])
      : await getPool().query(`SELECT * FROM nodes WHERE repo_id = $1 AND parent_id = $2`, [repoId, parentId]);
  return rows.map(rowToNode);
}

export async function getAllNodes(repoId: string): Promise<GraphNode[]> {
  const { rows } = await getPool().query(`SELECT * FROM nodes WHERE repo_id = $1`, [repoId]);
  return rows.map(rowToNode);
}

export async function getAllEdges(repoId: string): Promise<GraphEdge[]> {
  const { rows } = await getPool().query(`SELECT * FROM edges WHERE repo_id = $1`, [repoId]);
  return rows.map(rowToEdge);
}

export async function getEdgesForNode(nodeId: string, type?: EdgeType): Promise<{ outgoing: GraphEdge[]; incoming: GraphEdge[] }> {
  const db = getPool();
  const outgoingRes = type
    ? await db.query(`SELECT * FROM edges WHERE from_node_id = $1 AND type = $2`, [nodeId, type])
    : await db.query(`SELECT * FROM edges WHERE from_node_id = $1`, [nodeId]);
  const incomingRes = type
    ? await db.query(`SELECT * FROM edges WHERE to_node_id = $1 AND type = $2`, [nodeId, type])
    : await db.query(`SELECT * FROM edges WHERE to_node_id = $1`, [nodeId]);
  return { outgoing: outgoingRes.rows.map(rowToEdge), incoming: incomingRes.rows.map(rowToEdge) };
}

export async function searchNodes(repoId: string, query: string, limit = 50): Promise<GraphNode[]> {
  const { rows } = await getPool().query(`SELECT * FROM nodes WHERE repo_id = $1 AND name ILIKE $2 LIMIT $3`, [repoId, `%${query}%`, limit]);
  return rows.map(rowToNode);
}

/** Returns the transitive set of nodes that depend on a node through calls/imports. */
export async function getImpact(nodeId: string, repoId: string, maxDepth = 8): Promise<Array<{ node: GraphNode; depth: number; via: EdgeType[] }>> {
  const db = getPool();
  const seen = new Map<string, { depth: number; via: EdgeType[] }>();
  const queue: Array<{ id: string; depth: number; via: EdgeType[] }> = [{ id: nodeId, depth: 0, via: [] }];

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    const { rows } = await db.query(
      `SELECT e.type, e.from_node_id AS "fromNodeId" FROM edges e WHERE e.repo_id = $1 AND e.to_node_id = $2 AND e.type IN ('Calls', 'Imports')`,
      [repoId, current.id]
    );

    for (const row of rows as Array<{ type: EdgeType; fromNodeId: string }>) {
      if (row.fromNodeId === nodeId || seen.has(row.fromNodeId)) continue;
      const next = { depth: current.depth + 1, via: [...current.via, row.type] };
      seen.set(row.fromNodeId, next);
      queue.push({ id: row.fromNodeId, ...next });
    }
  }

  const results = await Promise.all([...seen.entries()].map(async ([id, info]) => ({ node: await getNode(id), ...info })));
  return results.filter((item): item is { node: GraphNode; depth: number; via: EdgeType[] } => Boolean(item.node));
}

export type { NodeType };
