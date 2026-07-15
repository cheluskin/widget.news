/**
 * Canonical URL for dedup (Monitors-like URL identity).
 * - https scheme, lower host, strip www
 * - drop trailing slash on path
 * - drop common tracking query params
 * - sort remaining query keys
 */
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const withProto = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);

    let path = u.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

    const drop =
      /^(utm_|fbclid$|gclid$|yclid$|mc_cid$|mc_eid$|igshid$|mibextid$|ref$|ref_src$|source$|spm$|_hsenc$|_hsmi$)/i;
    const kept = new Map<string, string[]>();
    for (const [k, v] of u.searchParams) {
      if (drop.test(k)) continue;
      const key = k.toLowerCase();
      const arr = kept.get(key) ?? [];
      arr.push(v);
      kept.set(key, arr);
    }
    const keys = [...kept.keys()].sort();
    const qs = new URLSearchParams();
    for (const k of keys) {
      for (const v of kept.get(k)!) qs.append(k, v);
    }
    const q = qs.toString();
    // Always https for identity (http/https same article)
    return `https://${host}${path === "/" ? "" : path}${q ? `?${q}` : ""}`;
  } catch {
    return null;
  }
}
