-- Upgrade script (NOT a fresh-schema initializer). Fresh installs use schema.sql.
--
-- v0.3.1: overlap lock for concurrent refresh — HISTORICAL, already applied
-- everywhere. SQLite has no ADD COLUMN IF NOT EXISTS, so uncommented this ALTER
-- would error on an upgraded DB and abort before the v0.6 steps below. Do NOT
-- uncomment.
-- ALTER TABLE widgets ADD COLUMN sync_locked_at TEXT;

-- v0.6.0: appearance prefs + presence for inactive lifecycle.
-- One-time upgrade only — run once on DBs created before these columns existed.
-- The ALTERs are NOT re-runnable: SQLite has no ADD COLUMN IF NOT EXISTS, so
-- re-running them errors on the first duplicate ALTER and aborts the file. If a
-- DB already has the v0.6 columns, recover via the standalone, independently
-- re-runnable backfill (src/db/backfill-last-seen.sql) instead of this file.
--
-- The entire v0.6 block below runs as exactly ONE transaction (BEGIN ... COMMIT).
-- Wrangler's d1 execute strips a single outer transaction layer and runs the SQL
-- inside D1's own transaction, so the ALTERs + seed + normalization + indexes
-- apply atomically: an interrupt cannot leave a partially-upgraded schema.
BEGIN TRANSACTION;

ALTER TABLE widgets ADD COLUMN borderless INTEGER NOT NULL DEFAULT 0;
ALTER TABLE widgets ADD COLUMN show_summaries INTEGER NOT NULL DEFAULT 1;
ALTER TABLE widgets ADD COLUMN last_seen_at TEXT;

-- Seed presence with UTC ISO text (same sortable shape as app Date.toISOString()
-- values) so legacy active widgets start a fresh 14-day observation window.
-- Using a fresh timestamp (not historical updated_at/created_at) avoids
-- immediately marking old widgets inactive while still giving them a full
-- INACTIVE_AFTER_MS before the first cron check. Only NULL rows are touched, so
-- this stays idempotent if re-run. CURRENT_TIMESTAMP is not used because its
-- `YYYY-MM-DD HH:MM:SS` space-separated form does not sort correctly against the
-- app's `YYYY-MM-DDTHH:MM:SS.sssZ` ISO strings.
UPDATE widgets
SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE last_seen_at IS NULL;

-- Normalize a legacy value ONLY when it matches the exact legacy SQLite shape
-- `YYYY-MM-DD HH:MM:SS`: exactly 19 characters with digits at fixed positions,
-- guarded by GLOB `[0-9]` character classes plus `length(...) = 19`, AND the
-- round-trip equality `strftime('%Y-%m-%d %H:%M:%S', last_seen_at) = last_seen_at`,
-- which holds only for a real calendar datetime. This leaves invalid
-- days/months/hours untouched: Sqlite would silently normalize (not preserve)
-- such values, so a syntactic GLOB match alone is not enough to keep them safe.
-- Any other value (incl. arbitrary space-containing text) is left untouched.
-- Harmless on a fresh NULL seed; reassures DBs that accumulated legacy values
-- from a partial/prior v0.6 attempt using CURRENT_TIMESTAMP or similar.
UPDATE widgets
SET last_seen_at = COALESCE(
    strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at),
    last_seen_at
)
WHERE last_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
  AND length(last_seen_at) = 19
  AND strftime('%Y-%m-%d %H:%M:%S', last_seen_at) = last_seen_at;

CREATE INDEX IF NOT EXISTS idx_widgets_token_hash ON widgets(admin_token_hash);
CREATE INDEX IF NOT EXISTS idx_widgets_last_seen ON widgets(status, last_seen_at);

COMMIT;
