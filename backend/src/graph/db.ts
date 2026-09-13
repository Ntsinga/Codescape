import Database from "better-sqlite3";
import { dbPath, ensureDataDirs } from "../storage/paths.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDirs();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      path TEXT NOT NULL,
      language TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_files_repo ON files(repo_id);

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      file_id TEXT,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      language TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_repo ON nodes(repo_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      type TEXT NOT NULL,
      confidence TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_edges_repo ON edges(repo_id);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);
  `);

  // Additive migration: semantic (logical) decomposition stored as a JSON blob
  // per repo. Guarded so re-running against an existing DB is a no-op.
  const cols = database.prepare(`PRAGMA table_info(repos)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "semantic_json")) {
    database.exec(`ALTER TABLE repos ADD COLUMN semantic_json TEXT`);
  }
  if (!cols.some((c) => c.name === "semantic_enriched")) {
    database.exec(`ALTER TABLE repos ADD COLUMN semantic_enriched INTEGER NOT NULL DEFAULT 0`);
  }
  // Origin tracking, so a repo can be re-imported in place.
  for (const [col, ddl] of [
    ["origin_kind", `ALTER TABLE repos ADD COLUMN origin_kind TEXT`],
    ["origin_owner", `ALTER TABLE repos ADD COLUMN origin_owner TEXT`],
    ["origin_repo", `ALTER TABLE repos ADD COLUMN origin_repo TEXT`],
    ["origin_branch", `ALTER TABLE repos ADD COLUMN origin_branch TEXT`],
  ] as const) {
    if (!cols.some((c) => c.name === col)) database.exec(ddl);
  }
}
