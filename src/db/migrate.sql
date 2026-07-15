-- v0.3.1: overlap lock for concurrent refresh
-- Safe to re-run if column already exists (will error once — ignore).
ALTER TABLE widgets ADD COLUMN sync_locked_at TEXT;
