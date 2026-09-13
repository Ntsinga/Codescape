import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let migrated: Promise<void> | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add a Postgres connection string (e.g. from Neon) to backend/.env.");
  }
  pool = new Pool({
    connectionString,
    // Neon (and most managed Postgres) require TLS; their cert chain isn't always
    // in Node's default trust store, so relax verification rather than fail closed.
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

/** Runs migrations once per process; safe to call repeatedly (subsequent calls await the same promise). */
export function ensureMigrated(): Promise<void> {
  if (!migrated) migrated = migrate();
  return migrated;
}

async function migrate(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      semantic_json TEXT,
      semantic_enriched BOOLEAN NOT NULL DEFAULT FALSE,
      origin_kind TEXT,
      origin_owner TEXT,
      origin_repo TEXT,
      origin_branch TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      path TEXT NOT NULL,
      language TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_files_repo ON files(repo_id);

    CREATE TABLE IF NOT EXISTS file_contents (
      repo_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (repo_id, path)
    );

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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}
