import type { Period, Theme, WidgetRow, WidgetStatus } from "./types";
import { isLockHeld, LOCK_STALE_MS } from "./period";

export async function getWidgetByPublicId(db: D1Database, publicId: string): Promise<WidgetRow | null> {
  return db.prepare("SELECT * FROM widgets WHERE public_id = ?").bind(publicId).first<WidgetRow>();
}

export async function getWidgetById(db: D1Database, id: string): Promise<WidgetRow | null> {
  return db.prepare("SELECT * FROM widgets WHERE id = ?").bind(id).first<WidgetRow>();
}

export async function listActiveWidgets(db: D1Database, limit = 50): Promise<WidgetRow[]> {
  const res = await db
    .prepare(
      `SELECT * FROM widgets WHERE status = 'active'
       ORDER BY CASE WHEN last_synced_at IS NULL THEN 0 ELSE 1 END,
                last_synced_at ASC,
                updated_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<WidgetRow>();
  return res.results ?? [];
}

export async function insertWidget(
  db: D1Database,
  row: {
    id: string;
    public_id: string;
    admin_token_hash: string;
    name: string | null;
    query: string;
    period: Period;
    num_results: number;
    widget_limit: number;
    theme: Theme;
    status: WidgetStatus;
    created_at: string;
    updated_at: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO widgets (
        id, public_id, admin_token_hash, name,
        query, period, num_results, widget_limit, theme, status,
        last_run_id, last_synced_at, sync_locked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(
      row.id,
      row.public_id,
      row.admin_token_hash,
      row.name,
      row.query,
      row.period,
      row.num_results,
      row.widget_limit,
      row.theme,
      row.status,
      row.created_at,
      row.updated_at,
    )
    .run();
}

export async function updateWidgetRow(
  db: D1Database,
  id: string,
  fields: Partial<{
    name: string | null;
    query: string;
    period: Period;
    num_results: number;
    widget_limit: number;
    theme: Theme;
    status: WidgetStatus;
    last_run_id: string | null;
    last_synced_at: string | null;
    sync_locked_at: string | null;
    updated_at: string;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    values.push(v);
  }
  if (!sets.length) return;
  values.push(id);
  await db
    .prepare(`UPDATE widgets SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Acquire overlap lock. Returns false if another non-stale lock is held.
 * Best-effort under concurrent D1 (not a full serializable lock).
 */
export async function tryAcquireSyncLock(db: D1Database, id: string): Promise<boolean> {
  const row = await getWidgetById(db, id);
  if (!row) return false;
  if (isLockHeld(row.sync_locked_at)) return false;
  const now = new Date().toISOString();
  // Clear only if unlocked or stale
  const res = await db
    .prepare(
      `UPDATE widgets SET sync_locked_at = ?, updated_at = ?
       WHERE id = ?
         AND (
           sync_locked_at IS NULL
           OR sync_locked_at < ?
         )`,
    )
    .bind(now, now, id, new Date(Date.now() - LOCK_STALE_MS).toISOString())
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function releaseSyncLock(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE widgets SET sync_locked_at = NULL WHERE id = ?`)
    .bind(id)
    .run();
}

export async function deleteWidgetRow(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM widgets WHERE id = ?").bind(id).run();
}
