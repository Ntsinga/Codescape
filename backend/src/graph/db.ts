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
      origin_branch TEXT,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_repos_user ON repos(user_id);

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

    -- Git history for the 3D timeline (GitHub imports only; zip uploads have none).
    CREATE TABLE IF NOT EXISTS repo_history (
      repo_id TEXT PRIMARY KEY,
      collected_at TEXT NOT NULL,
      files_json TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- GitHub OAuth: persisted so connections survive backend restarts/cold starts
    -- (the free tier recycles memory frequently, which would otherwise drop sessions).
    -- One token per Clerk user (not a bearer "connection" id) so a token can only
    -- ever be looked up under its owner's authenticated session.
    CREATE TABLE IF NOT EXISTS github_sessions (
      user_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS github_oauth_state (
      state TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    ALTER TABLE github_oauth_state ADD COLUMN IF NOT EXISTS user_id TEXT;
  `);

  // One-time rekey: the old github_sessions schema stored tokens under a random,
  // unauthenticated "connection" id that anyone holding it could use. Those rows
  // predate any user identity, so there's no owner to migrate them to. Rather than
  // delete them, rename the old table out of the way (nothing is destroyed; you can
  // inspect or drop it yourself later) and start a fresh, user_id-keyed table.
  // Guarded so later restarts (already migrated) are a no-op.
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'github_sessions' AND column_name = 'connection'`
  );
  if (rows.length > 0) {
    await db.query(`ALTER TABLE github_sessions RENAME TO github_sessions_legacy_connection_id`);
    await db.query(`
      CREATE TABLE github_sessions (
        user_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
}
