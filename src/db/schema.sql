CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  admin_token_hash TEXT NOT NULL,
  name TEXT,
  query TEXT NOT NULL,
  period TEXT NOT NULL,
  num_results INTEGER NOT NULL DEFAULT 10,
  widget_limit INTEGER NOT NULL DEFAULT 5,
  theme TEXT NOT NULL DEFAULT 'site',
  status TEXT NOT NULL DEFAULT 'active',
  borderless INTEGER NOT NULL DEFAULT 0,
  show_summaries INTEGER NOT NULL DEFAULT 1,
  last_run_id TEXT,
  last_synced_at TEXT,
  last_seen_at TEXT,
  sync_locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_widgets_public_id ON widgets(public_id);
CREATE INDEX IF NOT EXISTS idx_widgets_status ON widgets(status);
CREATE INDEX IF NOT EXISTS idx_widgets_last_synced ON widgets(status, last_synced_at);
CREATE INDEX IF NOT EXISTS idx_widgets_token_hash ON widgets(admin_token_hash);
CREATE INDEX IF NOT EXISTS idx_widgets_last_seen ON widgets(status, last_seen_at);
