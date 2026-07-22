import type { Period } from "./types.ts";

const MS: Record<Period, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/** Spread cron load across widgets (stable 0..30 min). */
export const JITTER_MAX_MS = 30 * 60 * 1000;

/** Stale lock after this — treat as abandoned run. */
export const LOCK_STALE_MS = 3 * 60 * 1000;

/** How long without embed presence before auto-inactive. */
export const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** New widgets are never auto-inactivated before this age. */
export const INACTIVE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Min interval between D1 last_seen_at writes (paired with Cache API throttle). */
export const SEEN_TOUCH_MS = 6 * 60 * 60 * 1000;

export function periodMs(period: Period): number {
  return MS[period] ?? MS["1d"];
}

/** Deterministic jitter 0..JITTER_MAX_MS from widget id (FNV-1a). */
export function jitterMs(widgetId: string): number {
  let h = 2166136261;
  for (let i = 0; i < widgetId.length; i++) {
    h ^= widgetId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % (JITTER_MAX_MS + 1);
}

/**
 * Whether the widget should run on the cron schedule.
 * - Never refreshed → due immediately
 * - After last success + period → wait jitter (load spread)
 * - More than one full period late → catch-up without waiting jitter
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
  if (now >= dueAt + need) return true;
  return false;
}

/**
 * `startPublishedDate` for Exa Search date filter.
 * - After a prior run: last_synced − 1×period (lookback buffer so we don't miss late indexes)
 * - First run: max(2×period, 24h)
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
      return new Date(last - p).toISOString();
    }
  }
  const firstLookback = Math.max(2 * p, 24 * 60 * 60 * 1000);
  return new Date(now - firstLookback).toISOString();
}

export function isLockHeld(lockedAt: string | null | undefined, now = Date.now()): boolean {
  if (!lockedAt) return false;
  const t = Date.parse(lockedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < LOCK_STALE_MS;
}

/** True when an active widget should be moved to inactive (no traffic). */
export function shouldMarkInactive(
  createdAt: string,
  lastSeenAt: string | null,
  now = Date.now(),
): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || now - created < INACTIVE_GRACE_MS) return false;
  if (!lastSeenAt) return true;
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return true;
  return now - seen >= INACTIVE_AFTER_MS;
}
