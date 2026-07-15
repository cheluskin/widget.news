import { cleanSummary } from "./clean-summary.ts";
import type { ExaSearchResult, FeedItem, FeedSnapshot, Theme, WidgetRow } from "./types.ts";
import { hashUrl } from "./ids.ts";
import { canonicalizeUrl } from "./urls-canon.ts";

export { cleanSummary } from "./clean-summary.ts";

function feedKey(publicId: string): string {
  return `feeds/${publicId}.json`;
}

function sourceFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeHighlights(h: ExaSearchResult["highlights"]): string[] {
  if (!h) return [];
  if (Array.isArray(h)) return h.filter(Boolean).map(String);
  if (typeof h === "string") return [h];
  return [];
}

export async function resultToItem(
  r: ExaSearchResult,
  seenAt: string,
  summaryOverride?: string | null,
): Promise<FeedItem | null> {
  const url = canonicalizeUrl(r.url) ?? (r.url?.trim() || null);
  if (!url) return null;
  const title = (r.title ?? "").trim() || url;
  const rawSummary =
    summaryOverride !== undefined
      ? summaryOverride
      : (r.summary ?? (typeof r.text === "string" ? r.text.slice(0, 280) : null));
  return {
    id: await hashUrl(url),
    title,
    url,
    publishedDate: r.publishedDate ?? null,
    summary: cleanSummary(rawSummary),
    highlights: normalizeHighlights(r.highlights),
    source: sourceFromUrl(url),
    seenAt,
  };
}

export async function readFeed(bucket: R2Bucket, publicId: string): Promise<FeedSnapshot | null> {
  const obj = await bucket.get(feedKey(publicId));
  if (!obj) return null;
  return (await obj.json()) as FeedSnapshot;
}

/** Empty feeds must not be cached long — browser would stick on "No stories yet" after sync. */
export function feedCacheControl(itemCount: number): string {
  if (itemCount <= 0) {
    return "public, max-age=0, s-maxage=0, must-revalidate";
  }
  return "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
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
  await bucket.delete(feedKey(publicId));
}

/**
 * Merge search results into R2 feed.
 * `summariesByUrl` — Workers AI (or fallback) summaries for new URLs.
 */
export async function mergeResultsIntoFeed(
  env: { FEEDS: R2Bucket; FEED_CAP: string },
  widget: WidgetRow,
  results: ExaSearchResult[],
  summariesByUrl?: Map<string, string | null>,
): Promise<FeedSnapshot> {
  const cap = Math.max(1, Number(env.FEED_CAP) || 100);
  const now = new Date().toISOString();
  const existing = (await readFeed(env.FEEDS, widget.public_id)) ?? {
    publicId: widget.public_id,
    query: widget.query,
    theme: widget.theme as Theme,
    widgetLimit: widget.widget_limit,
    updatedAt: now,
    items: [],
  };

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
    // For existing items: only pass override if we generated a new summary
    const summaryOverride =
      override !== undefined && override !== null
        ? override
        : canon && byUrl.has(canon)
          ? (byUrl.get(canon)!.summary ?? undefined)
          : override;
    const item = await resultToItem(
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
    theme: widget.theme as Theme,
    widgetLimit: widget.widget_limit,
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
    theme: widget.theme as Theme,
    widgetLimit: widget.widget_limit,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

/** Best-effort purge of CDN cache for feed URL (requires zone token in prod). */
export async function purgeFeedCache(
  env: { FEED_BASE_URL: string; CF_ZONE_ID?: string; CF_API_TOKEN?: string },
  publicId: string,
): Promise<void> {
  if (!env.CF_ZONE_ID || !env.CF_API_TOKEN) return;
  const url = `${env.FEED_BASE_URL.replace(/\/$/, "")}/f/${publicId}.json`;
  try {
    await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.CF_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ files: [url] }),
      },
    );
  } catch {
    // non-fatal
  }
}
