/** Public site locales (path prefix). English is the default at `/`. */
export const LOCALES = ["en", "ru", "uk"] as const;
export type Locale = (typeof LOCALES)[number];

const LOCALE_SET = new Set<string>(LOCALES);

/**
 * Parse `/ru/admin` → { locale: "ru", assetPath: "/admin" }
 * English has no prefix: `/admin` → { locale: "en", assetPath: "/admin" }
 * Optional `/en/...` is also accepted.
 */
export function parseLocalePath(pathname: string): { locale: Locale; assetPath: string } {
  const raw = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const m = raw.match(/^\/(en|ru|uk)(?=\/|$)/);
  if (m) {
    const locale = m[1] as Locale;
    let rest = raw.slice(m[0].length) || "/";
    if (!rest.startsWith("/")) rest = `/${rest}`;
    return { locale, assetPath: rest };
  }
  return { locale: "en", assetPath: raw || "/" };
}

export function isLocale(s: string): s is Locale {
  return LOCALE_SET.has(s);
}

/** Paths that must never be locale-stripped (API, feeds, health). */
export function isPassthroughPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/f/") ||
    pathname === "/health" ||
    pathname === "/api/health"
  );
}

/**
 * HTML app directories need a trailing slash (assets `auto-trailing-slash`).
 * Without this, ASSETS 307 Location: /admin/ drops the /ru|/uk prefix → redirect loop.
 */
export function needsHtmlTrailingSlash(assetPath: string): boolean {
  if (!assetPath || assetPath === "/") return false;
  if (assetPath.endsWith("/")) return false;
  // files like /embed.js, /app.css
  const last = assetPath.split("/").pop() || "";
  if (last.includes(".")) return false;
  return true;
}

/** Build public path with optional locale prefix: en → bare, ru → /ru + path. */
export function withLocalePrefix(locale: Locale, assetPath: string): string {
  const path = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
  if (locale === "en") return path || "/";
  if (path === "/") return `/${locale}/`;
  return `/${locale}${path}`;
}
