import {
  SUMMARY_MAX_CHARS,
  cleanSummary,
  finalizeSummary,
  softTrim,
  stripTitleEcho,
} from "./clean-summary.ts";
import type { SearchHit } from "./types.ts";
import { canonicalizeUrl } from "./urls-canon.ts";

const MODEL = "@cf/meta/llama-3.2-3b-instruct";

/**
 * Widget blurb sits under the headline in ~2 lines (CSS line-clamp:2, ~150 chars).
 * Must help the reader decide whether to open the article — not restate the title.
 */
const SYSTEM = `You write the short blurb under a news headline in a compact widget.

Hard limits:
- Fit in TWO short lines of UI text: about 120–150 characters total (including spaces). One sentence is ideal; two very short sentences max.
- Never restate or paraphrase the headline. The title is already shown above — add what is new, the stakes, who/what is affected, or the outcome.
- Complete thought only. Do not start a longer summary that would need cutting mid-sentence.
- Neutral news tone. No clickbait, no quotes of the whole title.
- No labels, headings, bullets, or prefixes (Summary / Key takeaways / Ключевые моменты / etc.).
- Same language as the article title and body.
- Output the blurb text only, nothing else.`;

function snippetFromHit(r: SearchHit): string {
  const parts: string[] = [];
  if (r.highlights?.length) parts.push(r.highlights.filter(Boolean).join("\n"));
  if (typeof r.text === "string" && r.text.trim()) {
    parts.push(r.text.trim().slice(0, 2500));
  }
  if (typeof r.summary === "string" && r.summary.trim()) {
    parts.push(r.summary.trim());
  }
  return parts.join("\n\n").trim();
}

/** Prefer a full sentence from highlights/text; avoid title-only or mid-cut mush. */
function fallbackSnippet(r: SearchHit, title: string): string | null {
  const raw = snippetFromHit(r);
  if (!raw) return null;

  // Prefer first 1–2 sentences under budget rather than arbitrary char slice
  const cleaned = cleanSummary(raw.replace(/\n+/g, " "));
  if (!cleaned) return null;

  let s = stripTitleEcho(cleaned, title);
  if (!s) {
    // Title-echo only material — try later sentences
    const parts = cleaned.split(/(?<=[.!?。])\s+/).filter(Boolean);
    s = parts.slice(1).join(" ").trim() || cleaned;
    s = stripTitleEcho(s, title);
  }
  if (!s) return null;

  return finalizeSummary(s, title, SUMMARY_MAX_CHARS);
}

function buildUserPrompt(title: string, body: string): string {
  return (
    `Headline (already shown in the UI — do NOT repeat it):\n${title}\n\n` +
    `Article text / excerpts:\n${body.slice(0, 2500)}\n\n` +
    `Write one tight blurb (~120–150 characters, max 2 short lines) that tells a skimmer what the article adds beyond the headline. Complete thought only.`
  );
}

/** Summarize one hit with Workers AI; fall back to highlights/text slice. */
export async function summarizeResult(ai: Ai, r: SearchHit): Promise<string | null> {
  const title = (r.title ?? "").trim() || r.url || "Article";
  const body = snippetFromHit(r);
  if (!body) {
    // No content — do not fake a summary from the title (would duplicate the headline)
    return null;
  }

  try {
    const out = (await ai.run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserPrompt(title, body) },
      ],
      // ~150 chars ≈ 40–60 tokens; keep headroom without inviting essays
      max_tokens: 80,
      temperature: 0.2,
    })) as { response?: string };

    const text = typeof out?.response === "string" ? out.response.trim() : "";
    const finalized = finalizeSummary(text, title, SUMMARY_MAX_CHARS);
    if (finalized) return finalized;
    return fallbackSnippet(r, title);
  } catch (e) {
    console.error("summarize failed", e);
    return fallbackSnippet(r, title);
  }
}

/**
 * Summarize all hits (already novelty-filtered) with a small concurrency pool.
 * Returns map of canonical URL → summary (or null).
 */
export async function summarizeHits(
  ai: Ai | undefined,
  results: SearchHit[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!results.length) return out;

  for (const r of results) {
    const u = canonicalizeUrl(r.url) ?? r.url;
    if (u) out.set(u, null);
  }

  if (!ai) {
    for (const r of results) {
      const u = canonicalizeUrl(r.url) ?? r.url;
      if (u) out.set(u, fallbackSnippet(r, (r.title ?? "").trim()));
    }
    return out;
  }

  const concurrency = 3;
  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const sums = await Promise.all(batch.map((r) => summarizeResult(ai, r)));
    batch.forEach((r, j) => {
      const u = canonicalizeUrl(r.url) ?? r.url;
      if (u) out.set(u, sums[j] ?? null);
    });
  }
  return out;
}

// re-export helpers used by tests / feed path
export { softTrim, finalizeSummary, SUMMARY_MAX_CHARS };
