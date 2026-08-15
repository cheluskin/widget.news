import * as db from "./db.ts";
import * as exa from "./exa.ts";
import { deleteFeed, mergeHitsIntoFeedLocked, purgeFeedCache, readFeed } from "./feed.ts";
import {
  INACTIVE_AFTER_MS,
  INACTIVE_GRACE_MS,
  isDue,
  isLockHeld,
  startPublishedDate,
} from "./schedule.ts";
import {
  appendNoveltyRun,
  deleteNovelty,
  filterNovelResults,
  readNovelty,
  writeNovelty,
} from "./novelty.ts";
import { summarizeHits } from "./summarize.ts";
import type { Period, WidgetRow } from "./types.ts";

export const OVERFETCH_MULTIPLIER = 2;
export const OVERFETCH_MIN_HEADROOM = 5;
export const MAX_EXA_RESULTS = 100;
export const DEFAULT_CRON_WIDGET_LIMIT = 40;
export const DEFAULT_CRON_CONCURRENCY = 4;

export interface RefreshResult {
  /** True when a search run completed and feed was updated. */
  refreshed: boolean;
  runId?: string;
  itemCount?: number;
  addedFromRun?: number;
  droppedDupes?: number;
  reason?: string;
}

/**
 * Search-based refresh pipeline (replaces any Exa Monitors flow):
 * 1. Overlap lock
 * 2. Exa Search with date window from last successful refresh
 * 3. Over-fetch → novelty filter (feed + last N runs, URL + title)
 * 4. Workers AI summaries for kept hits
 * 5. Merge feed + append novelty history
 */
export async function refreshWidget(env: Env, widget: WidgetRow): Promise<RefreshResult> {
  if (!env.EXA_API_KEY) {
    return { refreshed: false, reason: "no_exa_key" };
  }

  if (isLockHeld(widget.sync_locked_at)) {
    return {
      refreshed: false,
      reason: "run_in_progress",
      runId: widget.last_run_id ?? undefined,
    };
  }

  const token = await db.tryAcquireSyncLock(env.DB, widget.id);
  if (!token) {
    return { refreshed: false, reason: "run_in_progress" };
  }

  try {
    return await runRefresh(env, widget, token);
  } finally {
    await db
      .releaseSyncLock(env.DB, widget.id, token)
      .catch((e) => console.error("release lock", e));
  }
}

async function runRefresh(env: Env, widget: WidgetRow, token: string): Promise<RefreshResult> {
  const period = widget.period as Period;
  const want = Math.max(1, widget.num_results);
  // Over-fetch so novelty still fills the widget after drops
  const fetchN = Math.min(
    MAX_EXA_RESULTS,
    Math.max(want * OVERFETCH_MULTIPLIER, want + OVERFETCH_MIN_HEADROOM),
  );

  const startPub = startPublishedDate(period, widget.last_synced_at);
  const search = await exa.search(env.EXA_API_KEY, {
    query: widget.query,
    numResults: fetchN,
    startPublishedDate: startPub,
  });
  const raw = search.results;
  const runId = search.requestId ?? `search_${crypto.randomUUID()}`;

  const existing = await readFeed(env.FEEDS, widget.public_id);
  const feedRefs = (existing?.items ?? []).map((i) => ({ url: i.url, title: i.title }));
  const novelty = await readNovelty(env.FEEDS, widget.public_id);

  const { kept, dropped } = filterNovelResults(raw, novelty, feedRefs, { limit: want });

  const summaries = await summarizeHits(env.AI, kept);
  const snap = await mergeHitsIntoFeedLocked(env, widget, kept, summaries, token);
  await purgeFeedCache(env, widget.public_id);

  const nextNovelty = appendNoveltyRun(novelty, runId, kept);
  await writeNovelty(env.FEEDS, nextNovelty);

  const now = new Date().toISOString();
  await db.updateWidgetRow(env.DB, widget.id, {
    last_run_id: runId,
    last_synced_at: now,
    updated_at: now,
  });

  return {
    refreshed: true,
    runId,
    itemCount: snap.items.length,
    addedFromRun: kept.length,
    droppedDupes: dropped,
  };
}

/** Cron path: only when schedule says due. */
export async function refreshIfDue(env: Env, widget: WidgetRow): Promise<RefreshResult> {
  if (widget.status !== "active") {
    return { refreshed: false, reason: "paused" };
  }
  if (!isDue(widget.period as Period, widget.last_synced_at, widget.id)) {
    return {
      refreshed: false,
      reason: "not_due",
      runId: widget.last_run_id ?? undefined,
    };
  }
  return refreshWidget(env, widget);
}

/** Hourly cron: mark idle widgets inactive, then refresh due active ones. */
export async function refreshDueWidgets(
  env: Env,
  limit = DEFAULT_CRON_WIDGET_LIMIT,
  concurrency = DEFAULT_CRON_CONCURRENCY,
): Promise<{ checked: number; updated: number; skipped: number; inactivated: number }> {
  const inactivated = await markIdleWidgetsInactive(env).catch((e) => {
    console.error("markIdleWidgetsInactive", e);
    return 0;
  });

  if (!env.EXA_API_KEY) {
    return { checked: 0, updated: 0, skipped: 0, inactivated };
  }
  const widgets = await db.listActiveWidgets(env.DB, limit);
  let updated = 0;
  let skipped = 0;

  // Continuous worker pool with bounded concurrency prevents head-of-line blocking
  const poolSize = Math.min(concurrency, widgets.length);
  let nextIdx = 0;
  const workers = Array.from({ length: poolSize }, async () => {
    while (nextIdx < widgets.length) {
      const idx = nextIdx++;
      const w = widgets[idx];
      try {
        const r = await refreshIfDue(env, w);
        if (r.refreshed) updated++;
        else skipped++;
      } catch (e) {
        console.error("refresh due widget", w.public_id, e);
        skipped++;
      }
    }
  });
  await Promise.all(workers);

  return { checked: widgets.length, updated, skipped, inactivated };
}

/** Active widgets with no embed traffic past grace → inactive (cron stops Exa/AI). */
export async function markIdleWidgetsInactive(env: Env, now = Date.now()): Promise<number> {
  const nowIso = new Date(now).toISOString();
  const graceBeforeIso = new Date(now - INACTIVE_GRACE_MS).toISOString();
  const seenBeforeIso = new Date(now - INACTIVE_AFTER_MS).toISOString();
  return db.markInactiveWidgets(env.DB, { graceBeforeIso, seenBeforeIso, nowIso });
}

/** Used on widget delete — R2 objects + edge/CDN feed cache. */
export async function purgeWidgetArtifacts(env: Env, publicId: string): Promise<void> {
  await deleteFeed(env.FEEDS, publicId);
  await deleteNovelty(env.FEEDS, publicId);
  await purgeFeedCache(env, publicId);
}
