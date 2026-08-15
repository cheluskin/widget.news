import { finalizeSummary } from "./clean-summary.ts";
import type { FeedItem, FeedSnapshot, SearchHit, WidgetRow } from "./types.ts";
import { asBool, normalizeTheme } from "./types.ts";
import { hashUrl } from "./ids.ts";
import { canonicalizeUrl } from "./urls-canon.ts";

export { cleanSummary, finalizeSummary } from "./clean-summary.ts";

/**
 * Public CDN object key = URL path on R2 custom domain.
 * https://cdn.widget.news/f/{id}.json  →  key f/{id}.json
 */
export function feedKey(publicId: string): string {
  return `f/${publicId}.json`;
}

/** Legacy key before public CDN path alignment (read fallback only). */
function legacyFeedKey(publicId: string): string {
  return `feeds/${publicId}.json`;
}

function sourceFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function hitToItem(
  r: SearchHit,
  seenAt: string,
  summaryOverride?: string | null,
): Promise<FeedItem | null> {
  const url = canonicalizeUrl(r.url);
  if (!url) return null;
  const title = (r.title ?? "").trim() || url;
  // An explicit override is already finalized (and null stays null); only the
  // source fallback (r.summary / r.text) needs finalizing.
  const summary =
    summaryOverride !== undefined
      ? summaryOverride
      : finalizeSummary(
          r.summary ?? (typeof r.text === "string" ? r.text.slice(0, 400) : null),
          title,
        );
  return {
    id: await hashUrl(url),
    title,
    url,
    publishedDate: r.publishedDate ?? null,
    summary,
    highlights: r.highlights?.length ? r.highlights.filter(Boolean) : [],
    source: sourceFromUrl(url),
    seenAt,
  };
}

export async function readFeed(bucket: R2Bucket, publicId: string): Promise<FeedSnapshot | null> {
  let obj = await bucket.get(feedKey(publicId));
  // One-time migration path: objects written under feeds/ before CDN cutover
  if (!obj) obj = await bucket.get(legacyFeedKey(publicId));
  if (!obj) return null;
  try {
    return (await obj.json()) as FeedSnapshot;
  } catch (e) {
    console.warn(`readFeed: malformed json for feed ${publicId}`, e);
    return null;
  }
}

/**
 * Browser + shared cache policy for feed JSON.
 * - Empty: no shared cache (first fill must show up immediately)
 * - Non-empty: browser 60s, edge 5m, SWR 24h
 */
export function feedCacheControl(itemCount: number): string {
  if (itemCount <= 0) {
    return "public, max-age=0, s-maxage=0, must-revalidate";
  }
  return "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
}

/** Edge TTL string for CDN-Cache-Control (Cloudflare honors this over Cache-Control for edge). */
export function feedCdnCacheControl(itemCount: number): string {
  if (itemCount <= 0) return "max-age=0, must-revalidate";
  return "public, max-age=300, stale-while-revalidate=86400";
}

/**
 * Stable Cache API key — strip query so old embed `?_=` busting still hits the same edge entry
 * when/if Worker still runs (and so purge can target one URL).
 */
export function feedCacheRequest(origin: string, publicId: string): Request {
  const base = origin.replace(/\/$/, "");
  return new Request(`${base}/f/${encodeURIComponent(publicId)}.json`, {
    method: "GET",
  });
}

function feedResponseHeaders(itemCount: number, cacheStatus: "HIT" | "MISS" | "BYPASS"): Headers {
  const h = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": feedCacheControl(itemCount),
    "cdn-cache-control": feedCdnCacheControl(itemCount),
    "access-control-allow-origin": "*",
    "x-feed-cache": cacheStatus,
    vary: "Accept-Encoding",
  });
  return h;
}

/**
 * Serve feed JSON with Cloudflare Cache API (edge).
 * On HIT: no R2 read. On MISS: read R2 once, populate edge cache.
 */
export async function serveFeed(
  req: Request,
  env: { FEEDS: R2Bucket },
  ctx: ExecutionContext,
  publicId: string,
): Promise<Response> {
  const origin = new URL(req.url).origin;
  const cacheKey = feedCacheRequest(origin, publicId);
  const cache = caches.default;

  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("x-feed-cache", "HIT");
      headers.set("access-control-allow-origin", "*");
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
  } catch (e) {
    console.error("feed cache match", e);
  }

  const snap = await readFeed(env.FEEDS, publicId);
  if (!snap) {
    // Not-found is NOT edge-cached: a negative Cache-API entry would mask a
    // feed created moments later. Non-cacheable headers also keep CDNs honest.
    const res = new Response(JSON.stringify({ error: "Feed not found" }), {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=0, no-store",
        "cdn-cache-control": "no-store",
        "x-feed-cache": "MISS",
      },
    });
    return res;
  }

  const itemCount = snap.items?.length ?? 0;
  const body = JSON.stringify(snap);
  const res = new Response(body, {
    status: 200,
    headers: feedResponseHeaders(itemCount, "MISS"),
  });

  // Only edge-cache non-empty feeds (empty must revalidate after first refresh)
  if (itemCount > 0) {
    const store = new Response(body, {
      status: 200,
      headers: feedResponseHeaders(itemCount, "HIT"),
    });
    try {
      ctx.waitUntil(cache.put(cacheKey, store));
    } catch (e) {
      console.error("feed cache put", e);
    }
  }

  return res;
}

export async function writeFeed(
  bucket: R2Bucket,
  snapshot: FeedSnapshot,
  cacheControl?: string,
): Promise<void> {
  const body = JSON.stringify(snapshot);
  const cc = cacheControl ?? feedCacheControl(snapshot.items?.length ?? 0);
  await bucket.put(feedKey(snapshot.publicId), body, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: cc,
    },
    customMetadata: {
      "cache-tag": `feed-${snapshot.publicId}`,
    },
  });
}

export async function deleteFeed(bucket: R2Bucket, publicId: string): Promise<void> {
  await Promise.all([
    bucket.delete(feedKey(publicId)),
    bucket.delete(legacyFeedKey(publicId)),
  ]);
}

export const DEFAULT_FEED_CAP = 100;

/**
 * Merge search hits into R2 feed.
 * `summariesByUrl` — Workers AI (or fallback) summaries for new URLs.
 */
async function mergeHitsIntoFeed(
  env: { FEEDS: R2Bucket; FEED_CAP: string },
  widget: WidgetRow,
  results: SearchHit[],
  summariesByUrl?: Map<string, string | null>,
): Promise<FeedSnapshot> {
  const cap = Math.max(1, Number(env.FEED_CAP) || DEFAULT_FEED_CAP);
  const now = new Date().toISOString();
  const existing = (await readFeed(env.FEEDS, widget.public_id)) ?? emptyFeed(widget);
  // Old/malformed snapshots may be missing `items` or carry a non-array value.
  // Normalize to an empty list before iterating.
  const existingItems = Array.isArray(existing.items) ? existing.items : [];

  const byUrl = new Map<string, FeedItem>();
  for (const item of existingItems) {
    const key = canonicalizeUrl(item.url) ?? item.url;
    byUrl.set(key, { ...item, url: key });
  }

  // Independent async hitToItem conversions are parallelized via Promise.all;
  // dedupe/merge then runs sequentially below, so duplicate URLs keep their
  // first-seen title/highlight/summary-merge behavior in original input order.
  const converted = await Promise.all(
    results.map((r) => {
      const canon = canonicalizeUrl(r.url) ?? r.url;
      // A real explicit override is only a *present* map entry (canon preferred).
      // Importantly, a present-but-null value means "no new summary":
      // hitToItem returns null and the merge preserves the prior summary. No entry
      // at all means no override: hitToItem falls back to the source summary and a
      // resulting null still yields the prior summary through the merge below.
      let summaryOverride: string | null | undefined;
      if (canon && summariesByUrl?.has(canon)) {
        summaryOverride = summariesByUrl.get(canon);
      } else if (r.url && summariesByUrl?.has(r.url)) {
        summaryOverride = summariesByUrl.get(r.url);
      }
      return hitToItem(r, now, summaryOverride);
    }),
  );
  for (const item of converted) {
    if (!item) continue;
    const prev = byUrl.get(item.url);
    if (prev) {
      byUrl.set(item.url, {
        ...prev,
        title: item.title || prev.title,
        summary: item.summary ?? prev.summary,
        highlights: item.highlights.length ? item.highlights : prev.highlights,
        publishedDate: item.publishedDate ?? prev.publishedDate,
      });
    } else {
      byUrl.set(item.url, item);
    }
  }

  const items = [...byUrl.values()].sort((a, b) => {
    const da = a.publishedDate ?? a.seenAt;
    const db = b.publishedDate ?? b.seenAt;
    const ta = da ? Date.parse(da) : 0;
    const tb = db ? Date.parse(db) : 0;
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
      return tb - ta;
    }
    if (db > da) return 1;
    if (db < da) return -1;
    return 0;
  });

  const snapshot: FeedSnapshot = {
    publicId: widget.public_id,
    query: widget.query,
    title: widget.name,
    theme: normalizeTheme(widget.theme),
    widgetLimit: widget.widget_limit,
    borderless: asBool(widget.borderless, false),
    showSummaries: asBool(widget.show_summaries, true),
    updatedAt: now,
    items: items.slice(0, cap),
  };

  await writeFeed(env.FEEDS, snapshot);
  return snapshot;
}

/**
 * Lock-scoped entrypoint for refresh's read-merge-write.
 * `mergeHitsIntoFeed` is module-private: it rewrites the feed without its own
 * concurrency guard and cannot acquire the sync lock itself (no DB/id context).
 * Callers MUST hold the per-widget sync lock and pass its opaque token as
 * `lockToken` — refresh obtains it via db.tryAcquireSyncLock. Do not call from
 * anywhere that lacks lock ownership.
 */
export async function mergeHitsIntoFeedLocked(
  env: { FEEDS: R2Bucket; FEED_CAP: string },
  widget: WidgetRow,
  results: SearchHit[],
  summariesByUrl: Map<string, string | null> | undefined,
  _lockToken: string,
): Promise<FeedSnapshot> {
  return mergeHitsIntoFeed(env, widget, results, summariesByUrl);
}

export function emptyFeed(widget: WidgetRow): FeedSnapshot {
  return {
    publicId: widget.public_id,
    query: widget.query,
    title: widget.name,
    theme: normalizeTheme(widget.theme),
    widgetLimit: widget.widget_limit,
    borderless: asBool(widget.borderless, false),
    showSummaries: asBool(widget.show_summaries, true),
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

/** Patch presentation fields on an existing feed without rewriting items. */
export function feedPresentationFromWidget(widget: WidgetRow): Partial<FeedSnapshot> {
  return {
    query: widget.query,
    title: widget.name,
    theme: normalizeTheme(widget.theme),
    widgetLimit: widget.widget_limit,
    borderless: asBool(widget.borderless, false),
    showSummaries: asBool(widget.show_summaries, true),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Invalidate feed at the edge after write/refresh.
 * 1) Cache API delete on this colo (fast path for subsequent hits here)
 * 2) Optional zone purge API for global invalidation (needs CF_ZONE_ID + CF_API_TOKEN)
 */
export async function purgeFeedCache(
  env: {
    FEED_BASE_URL: string;
    PUBLIC_BASE_URL?: string;
    CF_ZONE_ID?: string;
    CF_API_TOKEN?: string;
  },
  publicId: string,
): Promise<void> {
  // Origins derive strictly from configured env — no hardcoded domains. The Set
  // dedupes when FEED_BASE_URL and PUBLIC_BASE_URL share a single origin.
  const origins = new Set<string>();
  for (const raw of [env.FEED_BASE_URL, env.PUBLIC_BASE_URL]) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw.includes("://") ? raw : `https://${raw}`).origin);
    } catch {
      /* skip bad */
    }
  }

  for (const origin of origins) {
    try {
      await caches.default.delete(feedCacheRequest(origin, publicId));
    } catch {
      /* local / unsupported */
    }
  }

  if (!env.CF_ZONE_ID || !env.CF_API_TOKEN) return;
  const files = [...origins].map((o) => `${o}/f/${encodeURIComponent(publicId)}.json`);
  try {
    await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CF_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ files }),
    });
  } catch {
    // non-fatal
  }
}
