import type { ExaSearchResult } from "./types";

const EXA_BASE = "https://api.exa.ai";

export class ExaError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = "ExaError";
  }
}

async function exaFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
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
  /** ISO date — only results published after this (optional) */
  startPublishedDate?: string;
}

export interface SearchResponse {
  requestId?: string;
  results: ExaSearchResult[];
}

/** Web search only — no Monitors. Highlights + short text for Workers AI summary. */
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
  return exaFetch(apiKey, "/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
