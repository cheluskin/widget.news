/**
 * Strip model labels and shape text for the widget blurb under each headline.
 * UI shows ~2 lines (line-clamp:2, ~140–160 chars) — summaries should feel complete, not cut mid-thought.
 */

/** Soft target for non-lead stories (2 lines at 13px). */
export const SUMMARY_MAX_CHARS = 150;
/** Slightly longer for the lead story in the list. */
export const SUMMARY_MAX_CHARS_LEAD = 170;

/**
 * Strip model labels like "Ключевые моменты статьи:", "Key takeaways:", etc.
 */
export function cleanSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  const label =
    /^(?:ключевые\s+моменты(?:\s+статьи)?|ключевой\s+вывод(?:\s+статьи)?|ключове\s+з\s+матеріалу|краткое\s+резюме|краткое\s+содержание|summary|key\s+(?:takeaways?|points?|findings?)|main\s+points?|article\s+summary|tl;?dr)\s*[:：\-—–]?\s*/i;

  for (let i = 0; i < 3; i++) {
    const next = s.replace(label, "").trim();
    if (next === s) break;
    s = next;
  }

  // Drop surrounding quotes the model sometimes adds
  s = s.replace(/^["«“„']+|["»”']+$/g, "").trim();
  s = s.replace(/^[\s]*[-•*–—]\s+/, "").trim();
  s = s.replace(/\s+-\s+/g, " · ").replace(/\s+/g, " ").trim();

  return s || null;
}

/** Normalize for title/summary comparison. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * If the blurb restates the headline, strip the overlapping prefix so the
 * reader gets new information (why open the article).
 */
export function stripTitleEcho(summary: string, title: string | null | undefined): string {
  let s = summary.trim();
  const t = (title ?? "").trim();
  if (!s || !t) return s;

  const ns = norm(s);
  const nt = norm(t);
  if (!nt || nt.length < 8) return s;

  // Full duplicate
  if (ns === nt || ns.startsWith(nt + " ") || nt.startsWith(ns)) {
    if (ns === nt || nt.startsWith(ns)) return "";
    // summary starts with title — drop that span in original casing by length ratio
    const ratio = t.length / nt.length;
    const cut = Math.min(s.length, Math.ceil(nt.length * ratio) + 2);
    s = s.slice(cut).replace(/^[\s:–—\-·,.;]+/, "").trim();
    return s;
  }

  // Shared first N words (headline + same opener)
  const tWords = nt.split(" ").filter(Boolean);
  const sWords = ns.split(" ").filter(Boolean);
  let shared = 0;
  while (
    shared < tWords.length &&
    shared < sWords.length &&
    tWords[shared] === sWords[shared]
  ) {
    shared++;
  }
  // Drop if most of the title is echoed at the start (≥4 words or ≥70% of title words)
  if (shared >= 4 || (tWords.length >= 3 && shared / tWords.length >= 0.7)) {
    const rawWords = s.split(/\s+/);
    s = rawWords.slice(shared).join(" ").replace(/^[\s:–—\-·,.;]+/, "").trim();
  }

  return s;
}

/**
 * Trim to maxLen at a natural break (sentence, then word) so it doesn't look
 * like the start of a much longer blurb.
 */
export function softTrim(text: string, maxLen = SUMMARY_MAX_CHARS): string {
  let s = text.replace(/\s+/g, " ").trim();
  if (!s || s.length <= maxLen) return s;

  const budget = maxLen - 1; // room for …
  const window = s.slice(0, budget);

  // Prefer end of a complete sentence in the window
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("。"),
    window.lastIndexOf("…"),
  );
  if (sentenceEnd >= Math.floor(maxLen * 0.45)) {
    return window.slice(0, sentenceEnd + 1).trim();
  }

  // Else break on word boundary
  const sp = window.lastIndexOf(" ");
  if (sp >= Math.floor(maxLen * 0.5)) {
    return window.slice(0, sp).replace(/[,:;·\-–—]+$/, "").trim() + "…";
  }

  return window.trim() + "…";
}

/**
 * Final pass after the model (or fallback): clean labels, drop title echo, fit 2 lines.
 */
export function finalizeSummary(
  raw: string | null | undefined,
  title?: string | null,
  maxLen = SUMMARY_MAX_CHARS,
): string | null {
  let s = cleanSummary(raw);
  if (!s) return null;
  s = stripTitleEcho(s, title);
  s = cleanSummary(s);
  if (!s) return null;
  s = softTrim(s, maxLen);
  return s || null;
}
