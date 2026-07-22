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
  const url = canonicalizeUrl(r.url) ?? (r.url?.trim() || null);
  if (!url) return null;
  const title = (r.title ?? "").trim() || url;
  const rawSummary =
    summaryOverride !== undefined
      ? summaryOverride
      : (r.summary ?? (typeof r.text === "string" ? r.text.slice(0, 400) : null));
  // finalize: strip labels, drop title echo, soft-trim to ~2 UI lines
  const summary =
    summaryOverride !== undefined && summaryOverride !== null
      ? finalizeSummary(summaryOverride, title)
      : finalizeSummary(rawSummary, title);
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
  return (await obj.json()) as FeedSnapshot;
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
    // Brief 404 cache reduces R2 hammering for bogus/bot ids
    const res = new Response(JSON.stringify({ error: "Feed not found" }), {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=30, s-maxage=30",
        "cdn-cache-control": "public, max-age=30",
        "x-feed-cache": "MISS",
      },
    });
    try {
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    } catch {
      /* ignore */
    }
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

/**
 * Merge search hits into R2 feed.
 * `summariesByUrl` — Workers AI (or fallback) summaries for new URLs.
 */
export async function mergeHitsIntoFeed(
  env: { FEEDS: R2Bucket; FEED_CAP: string },
  widget: WidgetRow,
  results: SearchHit[],
  summariesByUrl?: Map<string, string | null>,
): Promise<FeedSnapshot> {
  const cap = Math.max(1, Number(env.FEED_CAP) || 100);
  const now = new Date().toISOString();
  const existing = (await readFeed(env.FEEDS, widget.public_id)) ?? emptyFeed(widget);

  const byUrl = new Map<string, FeedItem>();
  for (const item of existing.items) {
    const key = canonicalizeUrl(item.url) ?? item.url;
    byUrl.set(key, { ...item, url: key });
  }

  for (const r of results) {
    const canon = canonicalizeUrl(r.url) ?? r.url;
    const override =
      (canon && summariesByUrl?.get(canon)) ??
      (r.url && summariesByUrl?.get(r.url)) ??
      undefined;
    const summaryOverride =
      override !== undefined && override !== null
        ? override
        : canon && byUrl.has(canon)
          ? (byUrl.get(canon)!.summary ?? undefined)
          : override;
    const item = await hitToItem(
      r,
      now,
      summaryOverride !== undefined ? summaryOverride : undefined,
    );
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
    return db.localeCompare(da);
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
  const origins = new Set<string>();
  for (const raw of [
    env.FEED_BASE_URL,
    env.PUBLIC_BASE_URL,
    "https://cdn.widget.news",
    "https://widget.news",
  ]) {
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
