import type { SearchHit } from "./types.ts";
import { canonicalizeUrl } from "./urls-canon.ts";

/** How many past refresh runs to keep for URL/title dedup. */
export const NOVELTY_RUN_HISTORY = 5;

export interface NoveltyItem {
  url: string;
  title: string;
  /** Normalized tokens for cheap similarity */
  tokens: string[];
}

export interface NoveltyRun {
  at: string;
  runId: string;
  items: NoveltyItem[];
}

export interface NoveltyState {
  publicId: string;
  runs: NoveltyRun[];
}

export interface FeedRef {
  url: string;
  title: string;
}

function noveltyKey(publicId: string): string {
  return `novelty/${publicId}.json`;
}

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "by", "from",
  "is", "are", "was", "were", "be", "as", "at", "it", "this", "that", "new", "news",
  "и", "в", "на", "с", "по", "для", "из", "о", "об", "как", "что", "это", "не", "за",
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeTitle(title: string): string[] {
  const n = normalizeTitle(title);
  if (!n) return [];
  return n
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Jaccard on token sets; 1 = identical. */
export function titleSimilarity(aTokens: string[], bTokens: string[]): number {
  if (!aTokens.length || !bTokens.length) return 0;
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const TITLE_SIM_THRESHOLD = 0.72;

export function itemFromHit(r: SearchHit): NoveltyItem | null {
  const url = canonicalizeUrl(r.url);
  if (!url) return null;
  const title = (r.title ?? "").trim() || url;
  return { url, title, tokens: tokenizeTitle(title) };
}

export async function readNovelty(bucket: R2Bucket, publicId: string): Promise<NoveltyState> {
  try {
    const obj = await bucket.get(noveltyKey(publicId));
    if (!obj) return { publicId, runs: [] };
    const j = (await obj.json()) as NoveltyState;
    return {
      publicId,
      runs: Array.isArray(j.runs) ? j.runs.slice(0, NOVELTY_RUN_HISTORY) : [],
    };
  } catch {
    return { publicId, runs: [] };
  }
}

export async function writeNovelty(bucket: R2Bucket, state: NoveltyState): Promise<void> {
  const runs = state.runs.slice(0, NOVELTY_RUN_HISTORY);
  await bucket.put(
    noveltyKey(state.publicId),
    JSON.stringify({ publicId: state.publicId, runs }),
    {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    },
  );
}

export async function deleteNovelty(bucket: R2Bucket, publicId: string): Promise<void> {
  await bucket.delete(noveltyKey(publicId));
}

export function collectHistorySets(state: NoveltyState): {
  urls: Set<string>;
  tokenSets: string[][];
} {
  const urls = new Set<string>();
  const tokenSets: string[][] = [];
  for (const run of state.runs) {
    for (const it of run.items) {
      const u = canonicalizeUrl(it.url) ?? it.url;
      if (u) urls.add(u);
      if (it.tokens?.length) tokenSets.push(it.tokens);
      else if (it.title) tokenSets.push(tokenizeTitle(it.title));
    }
  }
  return { urls, tokenSets };
}

function feedSeenSets(feed: FeedRef[]): { urls: Set<string>; tokenSets: string[][] } {
  const urls = new Set<string>();
  const tokenSets: string[][] = [];
  for (const it of feed) {
    const u = canonicalizeUrl(it.url) ?? it.url;
    if (u) urls.add(u);
    if (it.title) tokenSets.push(tokenizeTitle(it.title));
  }
  return { urls, tokenSets };
}

/**
 * Keep only hits that are new vs current feed and recent refresh history
 * (canonical URL match or near-duplicate titles).
 */
export function filterNovelResults(
  results: SearchHit[],
  novelty: NoveltyState,
  feed: FeedRef[],
  opts?: { threshold?: number; limit?: number },
): { kept: SearchHit[]; dropped: number } {
  const threshold = opts?.threshold ?? TITLE_SIM_THRESHOLD;
  const limit = opts?.limit;
  const hist = collectHistorySets(novelty);
  const feedSets = feedSeenSets(feed);

  const seenUrls = new Set<string>([...hist.urls, ...feedSets.urls]);
  const tokenSets = [...hist.tokenSets, ...feedSets.tokenSets];

  const kept: SearchHit[] = [];
  let dropped = 0;

  for (const r of results) {
    const canon = canonicalizeUrl(r.url);
    if (!canon) {
      dropped++;
      continue;
    }
    if (seenUrls.has(canon)) {
      dropped++;
      continue;
    }

    const tokens = tokenizeTitle((r.title ?? "").trim() || canon);
    let dup = false;
    for (const prev of tokenSets) {
      if (titleSimilarity(tokens, prev) >= threshold) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      for (const k of kept) {
        const kt = tokenizeTitle((k.title ?? "").trim() || k.url || "");
        if (titleSimilarity(tokens, kt) >= threshold) {
          dup = true;
          break;
        }
      }
    }
    if (dup) {
      dropped++;
      continue;
    }

    if (limit == null || kept.length < limit) {
      kept.push({ ...r, url: canon });
      seenUrls.add(canon);
      if (tokens.length) tokenSets.push(tokens);
    } else {
      dropped++;
    }
  }
  return { kept, dropped };
}

export function appendNoveltyRun(
  state: NoveltyState,
  runId: string,
  results: SearchHit[],
  at = new Date().toISOString(),
): NoveltyState {
  const items: NoveltyItem[] = [];
  for (const r of results) {
    const it = itemFromHit(r);
    if (it) items.push(it);
  }
  const runs = [{ at, runId, items }, ...state.runs].slice(0, NOVELTY_RUN_HISTORY);
  return { publicId: state.publicId, runs };
}
