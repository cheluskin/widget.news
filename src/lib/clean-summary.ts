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

  s = s.replace(/^[\s]*[-•*–—]\s+/, "").trim();
  s = s.replace(/\s+-\s+/g, " · ").replace(/\s+/g, " ").trim();

  return s || null;
}
