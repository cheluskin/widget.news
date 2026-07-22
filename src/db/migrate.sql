-- v0.3.1: overlap lock for concurrent refresh
-- Safe to re-run if column already exists (will error once — ignore).
ALTER TABLE widgets ADD COLUMN sync_locked_at TEXT;

-- v0.6.0: appearance prefs + presence for inactive lifecycle
ALTER TABLE widgets ADD COLUMN borderless INTEGER NOT NULL DEFAULT 0;
ALTER TABLE widgets ADD COLUMN show_summaries INTEGER NOT NULL DEFAULT 1;
ALTER TABLE widgets ADD COLUMN last_seen_at TEXT;

CREATE INDEX IF NOT EXISTS idx_widgets_token_hash ON widgets(admin_token_hash);
CREATE INDEX IF NOT EXISTS idx_widgets_last_seen ON widgets(status, last_seen_at);
