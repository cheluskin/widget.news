-- Idempotent presence seed/fix for v0.6 inactive lifecycle in UTC ISO text,
-- safe to re-run.
--
-- Two jobs:
--   1) Seed NULL last_seen_at rows with a fresh timestamp so legacy widgets get
--      a full 14-day observation window. Uses strftime UTC ISO (same sortable
--      shape as app Date.toISOString() values). CURRENT_TIMESTAMP is NOT used
--      because its space-separated `YYYY-MM-DD HH:MM:SS` does not sort against
--      the app's `YYYY-MM-DDTHH:MM:SS.sssZ` ISO strings.
--   2) Normalize a legacy value ONLY when it matches the exact legacy SQLite
--      shape `YYYY-MM-DD HH:MM:SS`: exactly 19 characters with digits at
--      positions 0-3/5-6/8-9/11-12/14-15/17-18 and separators `-`/` ` /`:` at
--      4/7/10/13/16. Guarded by GLOB `[0-9]` character classes on every digit
--      position plus `length(...) = 19`, AND the round-trip equality
--      `strftime('%Y-%m-%d %H:%M:%S', last_seen_at) = last_seen_at`, which holds
--      only for a real calendar datetime. This leaves invalid days/months/hours
--      untouched: Sqlite would silently normalize (not preserve) them, so the
--      GLOB+length guard alone is not enough. Any other value, including
--      arbitrary space-containing text, is left untouched. Already-valid ISO
--      timestamps without a space are untouched.
--
-- Both halves are idempotent: seeded rows aren't re-touched, and already-normal
-- ISO values are left alone.
UPDATE widgets
SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE last_seen_at IS NULL;

UPDATE widgets
SET last_seen_at = COALESCE(
    strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at),
    last_seen_at
)
WHERE last_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
  AND length(last_seen_at) = 19
  AND strftime('%Y-%m-%d %H:%M:%S', last_seen_at) = last_seen_at;
