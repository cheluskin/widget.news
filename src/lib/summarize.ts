import { cleanSummary } from "./clean-summary.ts";
import type { ExaSearchResult } from "./types.ts";
import { canonicalizeUrl } from "./urls-canon.ts";

const MODEL = "@cf/meta/llama-3.2-3b-instruct";

const SYSTEM = `Write 1-2 neutral sentences summarizing the article for a news widget.
No labels, headings, bullet points, or prefixes like Key takeaways / Summary / Ключевые моменты.
Reply with the summary only.`;

function snippetFromResult(r: ExaSearchResult): string {
  const parts: string[] = [];
  if (r.highlights) {
    if (Array.isArray(r.highlights)) parts.push(r.highlights.filter(Boolean).join("\n"));
    else if (typeof r.highlights === "string") parts.push(r.highlights);
  }
  if (typeof r.text === "string" && r.text.trim()) {
    parts.push(r.text.trim().slice(0, 2500));
  }
  if (typeof r.summary === "string" && r.summary.trim()) {
    parts.push(r.summary.trim());
  }
  return parts.join("\n\n").trim();
}

function fallbackSnippet(r: ExaSearchResult): string | null {
  const s = snippetFromResult(r);
  if (s) return cleanSummary(s.slice(0, 320));
  return null;
}

/**
 * Summarize one result with Workers AI. Falls back to highlights/text slice on failure.
 */
export async function summarizeResult(ai: Ai, r: ExaSearchResult): Promise<string | null> {
  const title = (r.title ?? "").trim() || r.url || "Article";
  const body = snippetFromResult(r);
  if (!body) {
    return cleanSummary(title.length > 20 ? title : null);
  }

  try {
    const out = (await ai.run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Title: ${title}\n\n${body.slice(0, 2500)}`,
        },
      ],
      max_tokens: 120,
      temperature: 0.2,
    })) as { response?: string };

    const text = typeof out?.response === "string" ? out.response.trim() : "";
    return cleanSummary(text) ?? fallbackSnippet(r);
  } catch (e) {
    console.error("summarize failed", e);
    return fallbackSnippet(r);
  }
}

/** Concurrent summaries with a small pool (Worker subrequest limits). */
export async function summarizeNewResults(
  ai: Ai | undefined,
  results: ExaSearchResult[],
  existingUrls: Set<string>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!results.length) return out;

  const existingCanon = new Set<string>();
  for (const u of existingUrls) {
    const c = canonicalizeUrl(u) ?? u;
    if (c) existingCanon.add(c);
  }

  const need = results.filter((r) => {
    const u = canonicalizeUrl(r.url) ?? r.url;
    return Boolean(u && !existingCanon.has(u));
  });

  for (const r of results) {
    const u = canonicalizeUrl(r.url) ?? r.url;
    if (u) out.set(u, null);
  }

  if (!ai) {
    for (const r of need) {
      const u = canonicalizeUrl(r.url) ?? r.url;
      if (u) out.set(u, fallbackSnippet(r));
    }
    return out;
  }

  const concurrency = 3;
  for (let i = 0; i < need.length; i += concurrency) {
    const batch = need.slice(i, i + concurrency);
    const sums = await Promise.all(batch.map((r) => summarizeResult(ai, r)));
    batch.forEach((r, j) => {
      const u = canonicalizeUrl(r.url) ?? r.url;
      if (u) out.set(u, sums[j] ?? null);
    });
  }
  return out;
}
