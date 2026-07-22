import * as db from "./db.ts";
import * as exa from "./exa.ts";
import { deleteFeed, mergeHitsIntoFeed, purgeFeedCache, readFeed } from "./feed.ts";
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

  const locked = await db.tryAcquireSyncLock(env.DB, widget.id);
  if (!locked) {
    return { refreshed: false, reason: "run_in_progress" };
  }

  try {
    return await runRefresh(env, widget);
  } finally {
    await db.releaseSyncLock(env.DB, widget.id).catch((e) => console.error("release lock", e));
  }
}

async function runRefresh(env: Env, widget: WidgetRow): Promise<RefreshResult> {
  const period = widget.period as Period;
  const want = Math.max(1, widget.num_results);
  // Over-fetch so novelty still fills the widget after drops
  const fetchN = Math.min(100, Math.max(want * 2, want + 5));

  const startPub = startPublishedDate(period, widget.last_synced_at);
  const search = await exa.search(env.EXA_API_KEY, {
    query: widget.query,
    numResults: fetchN,
    startPublishedDate: startPub,
  });
  const raw = search.results;
  const runId = search.requestId ?? `search_${Date.now()}`;

  const existing = await readFeed(env.FEEDS, widget.public_id);
  const feedRefs = (existing?.items ?? []).map((i) => ({ url: i.url, title: i.title }));
  const novelty = await readNovelty(env.FEEDS, widget.public_id);

  const { kept, dropped } = filterNovelResults(raw, novelty, feedRefs, { limit: want });

  const summaries = await summarizeHits(env.AI, kept);
  const snap = await mergeHitsIntoFeed(env, widget, kept, summaries);
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
  limit = 40,
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

  // Refreshes run in concurrent batches (concurrency 4) to prevent cron timeout
  const concurrency = 4;
  for (let i = 0; i < widgets.length; i += concurrency) {
    const batch = widgets.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((w) =>
        refreshIfDue(env, w).catch((e) => {
          console.error("refresh due widget", w.public_id, e);
          return { refreshed: false } as RefreshResult;
        }),
      ),
    );
    for (const r of results) {
      if (r.refreshed) updated++;
      else skipped++;
    }
  }

  return { checked: widgets.length, updated, skipped, inactivated };
}

/** Active widgets with no embed traffic past grace → inactive (cron stops Exa/AI). */
export async function markIdleWidgetsInactive(env: Env, now = Date.now()): Promise<number> {
  const nowIso = new Date(now).toISOString();
  const graceBeforeIso = new Date(now - INACTIVE_GRACE_MS).toISOString();
  const seenBeforeIso = new Date(now - INACTIVE_AFTER_MS).toISOString();
  return db.markInactiveWidgets(env.DB, { graceBeforeIso, seenBeforeIso, nowIso });
}

/** Used on widget delete. */
export async function purgeWidgetArtifacts(env: Env, publicId: string): Promise<void> {
  await deleteFeed(env.FEEDS, publicId);
  await deleteNovelty(env.FEEDS, publicId);
}
