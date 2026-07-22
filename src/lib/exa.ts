import type { SearchHit } from "./types.ts";

const EXA_BASE = "https://api.exa.ai";

export class ExaError extends Error {
  status: number;
  body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "ExaError";
    this.status = status;
    this.body = body;
  }
}

async function exaFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${EXA_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ExaError(`Exa ${init?.method ?? "GET"} ${path} failed: ${res.status}`, res.status, text);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export interface SearchParams {
  query: string;
  numResults: number;
  /** ISO — only results published on/after this date */
  startPublishedDate?: string;
}

export interface SearchResponse {
  requestId?: string;
  results: SearchHit[];
}

/** Raw wire shape from Exa /search (subset we care about). */
interface ExaWireResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  summary?: string;
  highlights?: string[] | string;
  text?: string | { text?: string };
  author?: string;
}

interface ExaWireSearchResponse {
  requestId?: string;
  results?: ExaWireResult[];
}

function normalizeHighlights(h: ExaWireResult["highlights"]): string[] | undefined {
  if (!h) return undefined;
  if (Array.isArray(h)) {
    const arr = h.filter(Boolean).map(String);
    return arr.length ? arr : undefined;
  }
  if (typeof h === "string" && h.trim()) return [h.trim()];
  return undefined;
}

function normalizeText(text: ExaWireResult["text"]): string | undefined {
  if (typeof text === "string" && text.trim()) return text.trim();
  if (text && typeof text === "object" && typeof text.text === "string" && text.text.trim()) {
    return text.text.trim();
  }
  return undefined;
}

/** Map Exa wire results into domain SearchHit. */
export function toSearchHits(raw: ExaWireResult[] | undefined): SearchHit[] {
  if (!raw?.length) return [];
  const out: SearchHit[] = [];
  for (const r of raw) {
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!url) continue;
    const hit: SearchHit = { url };
    if (r.title?.trim()) hit.title = r.title.trim();
    if (r.publishedDate) hit.publishedDate = r.publishedDate;
    if (r.summary?.trim()) hit.summary = r.summary.trim();
    if (r.author?.trim()) hit.author = r.author.trim();
    const highlights = normalizeHighlights(r.highlights);
    if (highlights) hit.highlights = highlights;
    const text = normalizeText(r.text);
    if (text) hit.text = text;
    out.push(hit);
  }
  return out;
}

/**
 * Exa Search only (no Monitors API).
 * Requests highlights + short text for Workers AI summaries.
 */
export async function search(apiKey: string, params: SearchParams): Promise<SearchResponse> {
  const body: Record<string, unknown> = {
    query: params.query,
    numResults: params.numResults,
    type: "auto",
    contents: {
      highlights: true,
      text: { maxCharacters: 2500 },
    },
  };
  if (params.startPublishedDate) {
    body.startPublishedDate = params.startPublishedDate;
  }

  const raw = await exaFetch<ExaWireSearchResponse>(apiKey, "/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    requestId: raw.requestId,
    results: toSearchHits(raw.results),
  };
}
