import { getDb } from "./db.js";
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

export function insertRepo(repo: RepoRecord): void {
  getDb()
    .prepare(`INSERT INTO repos (id, name, created_at, status, error) VALUES (?, ?, ?, ?, ?)`)
    .run(repo.id, repo.name, repo.createdAt, repo.status, repo.error);
}

export function updateRepoStatus(id: string, status: RepoRecord["status"], error?: string): void {
  getDb().prepare(`UPDATE repos SET status = ?, error = ? WHERE id = ?`).run(status, error ?? null, id);
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

export function getRepo(id: string): RepoRecord | undefined {
  const row = getDb().prepare(`SELECT * FROM repos WHERE id = ?`).get(id) as any;
  return row ? rowToRepo(row) : undefined;
}

export function listRepos(): RepoRecord[] {
  const rows = getDb().prepare(`SELECT * FROM repos ORDER BY created_at DESC`).all() as any[];
  return rows.map(rowToRepo);
}

export function setRepoOrigin(id: string, origin: RepoOrigin): void {
  getDb()
    .prepare(`UPDATE repos SET origin_kind = ?, origin_owner = ?, origin_repo = ?, origin_branch = ? WHERE id = ?`)
    .run(origin.kind, origin.owner, origin.repo, origin.branch, id);
}

/** Clears a repo's derived graph + semantic data (for in-place re-import). */
export function clearRepoGraph(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM nodes WHERE repo_id = ?`).run(id);
    db.prepare(`DELETE FROM edges WHERE repo_id = ?`).run(id);
    db.prepare(`DELETE FROM files WHERE repo_id = ?`).run(id);
    db.prepare(`UPDATE repos SET semantic_json = NULL, semantic_enriched = 0 WHERE id = ?`).run(id);
  });
  tx();
}

export function saveSemanticTree(repoId: string, tree: unknown, enriched: boolean): void {
  getDb()
    .prepare(`UPDATE repos SET semantic_json = ?, semantic_enriched = ? WHERE id = ?`)
    .run(JSON.stringify(tree), enriched ? 1 : 0, repoId);
}

export function getSemanticTree(repoId: string): { tree: any; enriched: boolean } | undefined {
  const row = getDb().prepare(`SELECT semantic_json, semantic_enriched FROM repos WHERE id = ?`).get(repoId) as any;
  if (!row || !row.semantic_json) return undefined;
  try {
    return { tree: JSON.parse(row.semantic_json), enriched: Boolean(row.semantic_enriched) };
  } catch {
    return undefined;
  }
}

export function insertFile(id: string, repoId: string, filePath: string, language: string | null): void {
  getDb().prepare(`INSERT INTO files (id, repo_id, path, language) VALUES (?, ?, ?, ?)`).run(id, repoId, filePath, language);
}

const insertNodeStmt = () =>
  getDb().prepare(`
    INSERT INTO nodes (id, repo_id, type, name, parent_id, file_id, file_path, start_line, end_line, language, metadata)
    VALUES (@id, @repoId, @type, @name, @parentId, @fileId, @filePath, @startLine, @endLine, @language, @metadata)
  `);

export function insertNode(node: GraphNode): void {
  insertNodeStmt().run({
    id: node.id,
    repoId: node.repoId,
    type: node.type,
    name: node.name,
    parentId: node.parentId,
    fileId: node.fileId,
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    language: node.language,
    metadata: JSON.stringify(node.metadata ?? {}),
  });
}

export function insertNodesBatch(nodes: GraphNode[]): void {
  const stmt = insertNodeStmt();
  const tx = getDb().transaction((items: GraphNode[]) => {
    for (const n of items) {
      stmt.run({
        id: n.id,
        repoId: n.repoId,
        type: n.type,
        name: n.name,
        parentId: n.parentId,
        fileId: n.fileId,
        filePath: n.filePath,
        startLine: n.startLine,
        endLine: n.endLine,
        language: n.language,
        metadata: JSON.stringify(n.metadata ?? {}),
      });
    }
  });
  tx(nodes);
}

export function insertEdgesBatch(edges: GraphEdge[]): void {
  const stmt = getDb().prepare(`
    INSERT INTO edges (id, repo_id, from_node_id, to_node_id, type, confidence, evidence)
    VALUES (@id, @repoId, @fromNodeId, @toNodeId, @type, @confidence, @evidence)
  `);
  const tx = getDb().transaction((items: GraphEdge[]) => {
    for (const e of items) {
      stmt.run({
        id: e.id,
        repoId: e.repoId,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        type: e.type,
        confidence: e.confidence,
        evidence: JSON.stringify(e.evidence),
      });
    }
  });
  tx(edges);
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

export function getNode(nodeId: string): GraphNode | undefined {
  const row = getDb().prepare(`SELECT * FROM nodes WHERE id = ?`).get(nodeId) as any;
  return row ? rowToNode(row) : undefined;
}

export function getChildren(parentId: string | null, repoId: string): GraphNode[] {
  const rows =
    parentId === null
      ? (getDb().prepare(`SELECT * FROM nodes WHERE repo_id = ? AND parent_id IS NULL`).all(repoId) as any[])
      : (getDb().prepare(`SELECT * FROM nodes WHERE repo_id = ? AND parent_id = ?`).all(repoId, parentId) as any[]);
  return rows.map(rowToNode);
}

export function getAllNodes(repoId: string): GraphNode[] {
  const rows = getDb().prepare(`SELECT * FROM nodes WHERE repo_id = ?`).all(repoId) as any[];
  return rows.map(rowToNode);
}

export function getAllEdges(repoId: string): GraphEdge[] {
  const rows = getDb().prepare(`SELECT * FROM edges WHERE repo_id = ?`).all(repoId) as any[];
  return rows.map(rowToEdge);
}

export function getEdgesForNode(nodeId: string, type?: EdgeType): { outgoing: GraphEdge[]; incoming: GraphEdge[] } {
  const db = getDb();
  const outgoing = (
    type
      ? db.prepare(`SELECT * FROM edges WHERE from_node_id = ? AND type = ?`).all(nodeId, type)
      : db.prepare(`SELECT * FROM edges WHERE from_node_id = ?`).all(nodeId)
  ) as any[];
  const incoming = (
    type
      ? db.prepare(`SELECT * FROM edges WHERE to_node_id = ? AND type = ?`).all(nodeId, type)
      : db.prepare(`SELECT * FROM edges WHERE to_node_id = ?`).all(nodeId)
  ) as any[];
  return { outgoing: outgoing.map(rowToEdge), incoming: incoming.map(rowToEdge) };
}

export function searchNodes(repoId: string, query: string, limit = 50): GraphNode[] {
  const rows = getDb()
    .prepare(`SELECT * FROM nodes WHERE repo_id = ? AND name LIKE ? COLLATE NOCASE LIMIT ?`)
    .all(repoId, `%${query}%`, limit) as any[];
  return rows.map(rowToNode);
}

/** Returns the transitive set of nodes that depend on a node through calls/imports. */
export function getImpact(nodeId: string, repoId: string, maxDepth = 8): Array<{ node: GraphNode; depth: number; via: EdgeType[] }> {
  const db = getDb();
  const seen = new Map<string, { depth: number; via: EdgeType[] }>();
  const queue: Array<{ id: string; depth: number; via: EdgeType[] }> = [{ id: nodeId, depth: 0, via: [] }];

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    const rows = db.prepare(`
      SELECT e.type, e.from_node_id AS fromNodeId
      FROM edges e
      WHERE e.repo_id = ? AND e.to_node_id = ? AND e.type IN ('Calls', 'Imports')
    `).all(repoId, current.id) as Array<{ type: EdgeType; fromNodeId: string }>;

    for (const row of rows) {
      if (row.fromNodeId === nodeId || seen.has(row.fromNodeId)) continue;
      const next = { depth: current.depth + 1, via: [...current.via, row.type] };
      seen.set(row.fromNodeId, next);
      queue.push({ id: row.fromNodeId, ...next });
    }
  }

  return [...seen.entries()]
    .map(([id, info]) => ({ node: getNode(id), ...info }))
    .filter((item): item is { node: GraphNode; depth: number; via: EdgeType[] } => Boolean(item.node));
}

export type { NodeType };
