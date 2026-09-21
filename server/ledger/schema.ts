export const schema = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS source_connections (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, external_id)
  );

  CREATE TABLE IF NOT EXISTS connection_configs (
    source_connection_id INTEGER PRIMARY KEY REFERENCES source_connections(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS iterations (
    id INTEGER PRIMARY KEY,
    source_connection_id INTEGER NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    goal TEXT,
    starts_at TEXT,
    ends_at TEXT,
    raw_json TEXT NOT NULL,
    UNIQUE(source_connection_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS work_items (
    id INTEGER PRIMARY KEY,
    source_connection_id INTEGER NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
    iteration_id INTEGER REFERENCES iterations(id) ON DELETE SET NULL,
    external_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT,
    assignee TEXT,
    estimate REAL,
    comment_count INTEGER NOT NULL,
    review_state TEXT NOT NULL,
    source_updated_at TEXT NOT NULL,
    url TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    UNIQUE(source_connection_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS work_item_relationships (
    id INTEGER PRIMARY KEY,
    source_connection_id INTEGER NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
    from_work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    to_work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE(source_connection_id, from_work_item_id, to_work_item_id, kind)
  );

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY,
    source_connection_id INTEGER NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
    work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
    external_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    actor TEXT,
    url TEXT,
    payload_json TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    UNIQUE(source_connection_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS sync_checkpoints (
    source_connection_id INTEGER PRIMARY KEY REFERENCES source_connections(id) ON DELETE CASCADE,
    cursor TEXT,
    synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    source_connection_id INTEGER NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    duration_ms REAL NOT NULL,
    status TEXT NOT NULL,
    request_count INTEGER NOT NULL,
    batch_count INTEGER NOT NULL,
    item_count INTEGER NOT NULL,
    events_added INTEGER NOT NULL,
    relationship_count INTEGER NOT NULL,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS sprint_snapshots (
    id TEXT PRIMARY KEY,
    iteration_id INTEGER NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
    captured_at TEXT NOT NULL,
    item_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sprint_snapshot_items (
    snapshot_id TEXT NOT NULL REFERENCES sprint_snapshots(id) ON DELETE CASCADE,
    work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    PRIMARY KEY(snapshot_id, work_item_id)
  );

  CREATE INDEX IF NOT EXISTS idx_work_items_iteration
    ON work_items(iteration_id);
  CREATE INDEX IF NOT EXISTS idx_events_occurred_at
    ON activity_events(source_connection_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_snapshots_iteration
    ON sprint_snapshots(iteration_id, captured_at);
  CREATE INDEX IF NOT EXISTS idx_sync_runs_connection
    ON sync_runs(source_connection_id, completed_at);

  PRAGMA user_version = 3;
`;
