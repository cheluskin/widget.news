import type { Period, WidgetRow } from "./types";

const MS: Record<Period, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/** Exa Monitors: up to 30 minutes of jitter to spread load. */
export const JITTER_MAX_MS = 30 * 60 * 1000;

/** Stale lock after this — treat as abandoned run (overlap prevention). */
export const LOCK_STALE_MS = 3 * 60 * 1000;

export function periodMs(period: Period): number {
  return MS[period] ?? MS["1d"];
}

/**
 * Stable jitter 0..JITTER_MAX_MS from widget id (like Exa create-time spread).
 */
export function jitterMs(widgetId: string): number {
  let h = 2166136261;
  for (let i = 0; i < widgetId.length; i++) {
    h ^= widgetId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % (JITTER_MAX_MS + 1);
}

/**
 * Whether this widget should run on the schedule (cron).
 * Mirrors Monitors: period since last successful sync + stable jitter after due time.
 * First sync is always due. Overdue by a full extra period bypasses jitter (catch-up).
 */
export function isDue(
  period: Period,
  lastSyncedAt: string | null,
  widgetId: string,
  now = Date.now(),
): boolean {
  if (!lastSyncedAt) return true;
  const last = Date.parse(lastSyncedAt);
  if (!Number.isFinite(last)) return true;

  const need = periodMs(period);
  const dueAt = last + need;
  if (now < dueAt) return false;

  const j = jitterMs(widgetId);
  if (now >= dueAt + j) return true;
  // Catch-up: more than one full period late → run without waiting jitter
  if (now >= dueAt + need) return true;
  return false;
}

/**
 * Date window for Exa startPublishedDate (Monitors-style).
 * - With prior run: last_synced − 1×period (2× overlap buffer vs next interval).
 * - First run: lookback max(2×period, 24h).
 */
export function startPublishedDate(
  period: Period,
  lastSyncedAt: string | null,
  now = Date.now(),
): string {
  const p = periodMs(period);
  if (lastSyncedAt) {
    const last = Date.parse(lastSyncedAt);
    if (Number.isFinite(last)) {
      // Content since last run, with one period of lookback buffer (≈ 2× window on schedule)
      return new Date(last - p).toISOString();
    }
  }
  const firstLookback = Math.max(2 * p, 24 * 60 * 60 * 1000);
  return new Date(now - firstLookback).toISOString();
}

/** @deprecated use startPublishedDate */
export function startPublishedDateForPeriod(period: Period, now = Date.now()): string {
  return startPublishedDate(period, null, now);
}

export function isLockHeld(lockedAt: string | null | undefined, now = Date.now()): boolean {
  if (!lockedAt) return false;
  const t = Date.parse(lockedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < LOCK_STALE_MS;
}

export function scheduleMeta(widget: Pick<WidgetRow, "id" | "period" | "last_synced_at" | "created_at">, now = Date.now()) {
  const p = widget.period as Period;
  const j = jitterMs(widget.id);
  const last = widget.last_synced_at ? Date.parse(widget.last_synced_at) : null;
  const dueAt = last && Number.isFinite(last) ? last + periodMs(p) : null;
  return {
    periodMs: periodMs(p),
    jitterMs: j,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    fireAfter: dueAt ? new Date(dueAt + j).toISOString() : null,
    isDue: isDue(p, widget.last_synced_at, widget.id, now),
    startPublishedDate: startPublishedDate(p, widget.last_synced_at, now),
  };
}
