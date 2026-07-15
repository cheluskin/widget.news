import * as db from "./db";
import * as exa from "./exa";
import { deleteFeed, mergeResultsIntoFeed, purgeFeedCache, readFeed } from "./feed";
import {
  isDue,
  isLockHeld,
  startPublishedDate,
} from "./period";
import {
  appendNoveltyRun,
  deleteNovelty,
  filterNovelResults,
  readNovelty,
  writeNovelty,
} from "./novelty";
import { summarizeNewResults } from "./summarize";
import type { Period, WidgetRow } from "./types";

export interface IngestResult {
  synced: boolean;
  runId?: string;
  itemCount?: number;
  addedFromRun?: number;
  droppedDupes?: number;
  reason?: string;
}

export interface RefreshOptions {
  /** Skip schedule check (manual refresh/sync). Still uses lock + novelty. */
  force?: boolean;
}

/**
 * Monitors-like pipeline:
 * 1. Overlap lock
 * 2. Exa Search with date window (last run − period buffer)
 * 3. Over-fetch → novelty filter (last 5 runs URL + title similarity)
 * 4. Workers AI summaries for new URLs
 * 5. Merge feed + append novelty history
 */
export async function refreshWidget(
  env: Env,
  widget: WidgetRow,
  opts: RefreshOptions = {},
): Promise<IngestResult> {
  if (!env.EXA_API_KEY) {
    return { synced: false, reason: "no_exa_key" };
  }

  // Overlap prevention: another run in progress
  if (isLockHeld(widget.sync_locked_at)) {
    return { synced: false, reason: "run_in_progress", runId: widget.last_run_id ?? undefined };
  }

  const locked = await db.tryAcquireSyncLock(env.DB, widget.id);
  if (!locked) {
    return { synced: false, reason: "run_in_progress" };
  }

  try {
    return await runRefresh(env, widget, opts);
  } finally {
    await db.releaseSyncLock(env.DB, widget.id).catch((e) => console.error("release lock", e));
  }
}

async function runRefresh(env: Env, widget: WidgetRow, _opts: RefreshOptions): Promise<IngestResult> {
  const period = widget.period as Period;
  const want = Math.max(1, widget.num_results);
  // Over-fetch so novelty filter still fills the widget
  const fetchN = Math.min(100, Math.max(want * 2, want + 5));

  const startPub = startPublishedDate(period, widget.last_synced_at);
  const search = await exa.search(env.EXA_API_KEY, {
    query: widget.query,
    numResults: fetchN,
    startPublishedDate: startPub,
  });
  const raw = search.results ?? [];
  const runId = search.requestId ?? `search_${Date.now()}`;

  const existing = await readFeed(env.FEEDS, widget.public_id);
  const feedRefs = (existing?.items ?? []).map((i) => ({ url: i.url, title: i.title }));
  const novelty = await readNovelty(env.FEEDS, widget.public_id);

  const { kept, dropped } = filterNovelResults(raw, novelty, feedRefs, { limit: want });
  const results = kept;

  // kept is already novel vs feed+history — summarize all of them
  const summaries = await summarizeNewResults(env.AI, results, new Set());
  const snap = await mergeResultsIntoFeed(env, widget, results, summaries);
  await purgeFeedCache(env, widget.public_id);

  const nextNovelty = appendNoveltyRun(novelty, runId, results);
  await writeNovelty(env.FEEDS, nextNovelty);

  const now = new Date().toISOString();
  await db.updateWidgetRow(env.DB, widget.id, {
    last_run_id: runId,
    last_synced_at: now,
    updated_at: now,
  });

  return {
    synced: true,
    runId,
    itemCount: snap.items.length,
    addedFromRun: results.length,
    droppedDupes: dropped,
  };
}

/** Cron path: only when schedule says due. */
export async function refreshIfDue(env: Env, widget: WidgetRow): Promise<IngestResult> {
  if (widget.status !== "active") {
    return { synced: false, reason: "paused" };
  }
  if (!isDue(widget.period as Period, widget.last_synced_at, widget.id)) {
    return {
      synced: false,
      reason: "not_due",
      runId: widget.last_run_id ?? undefined,
    };
  }
  return refreshWidget(env, widget, { force: false });
}

/** Hourly cron: due active widgets (schedule + jitter). */
export async function reconcileAll(
  env: Env,
  limit = 40,
): Promise<{ checked: number; updated: number; skipped: number }> {
  if (!env.EXA_API_KEY) return { checked: 0, updated: 0, skipped: 0 };
  const widgets = await db.listActiveWidgets(env.DB, limit);
  let updated = 0;
  let skipped = 0;
  for (const w of widgets) {
    try {
      const r = await refreshIfDue(env, w);
      if (r.synced) updated++;
      else skipped++;
    } catch (e) {
      console.error("reconcile widget", w.public_id, e);
      skipped++;
    }
  }
  return { checked: widgets.length, updated, skipped };
}

/** Used on widget delete. */
export async function purgeWidgetArtifacts(env: Env, publicId: string): Promise<void> {
  await deleteFeed(env.FEEDS, publicId);
  await deleteNovelty(env.FEEDS, publicId);
}
