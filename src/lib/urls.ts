import { asBool, normalizeTheme, type WidgetRow } from "./types.ts";

/** Public site origin for embed/script URLs. */
export function publicBase(env: Env, req?: Request): string {
  const configured = (env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (req) {
    const origin = new URL(req.url).origin;
    if (!configured || isLocalUrl(configured)) {
      return origin;
    }
  }
  return configured || "http://localhost:8787";
}

/** Feed CDN base (R2 custom domain in prod). */
export function feedBase(env: Env, req?: Request): string {
  const configured = (env.FEED_BASE_URL || "").replace(/\/$/, "");
  if (configured && !isLocalUrl(configured)) return configured;
  return publicBase(env, req);
}

export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

export function feedUrl(env: Env, publicId: string, req?: Request): string {
  return `${feedBase(env, req)}/f/${encodeURIComponent(publicId)}.json`;
}

/**
 * Dashboard deep link carrying the token once via a URL fragment
 * (…/admin/#token=…), never a query string. The browser stores the key in
 * localStorage and scrubs the fragment; the fragment is client-only and is NOT
 * sent to the server in an HTTP request, so the key never appears in server
 * logs or referrers. Later visits to /admin auto-login without any fragment.
 */
export function adminUrl(env: Env, _publicId: string, adminToken: string, req?: Request): string {
  const base = publicBase(env, req);
  return `${base}/admin/#token=${encodeURIComponent(adminToken)}`;
}

export type EmbedOpts = {
  publicId: string;
  theme: string;
  widgetLimit: number;
  title?: string | null;
  borderless?: boolean;
  showSummaries?: boolean;
};

export function embedOptsFromRow(row: WidgetRow): EmbedOpts {
  return {
    publicId: row.public_id,
    theme: normalizeTheme(row.theme),
    widgetLimit: row.widget_limit,
    title: row.name,
    borderless: asBool(row.borderless, false),
    showSummaries: asBool(row.show_summaries, true),
  };
}

export function embedSnippet(env: Env, opts: EmbedOpts, req?: Request): string {
  const base = publicBase(env, req);
  const feed = feedBase(env, req);
  const parts = [
    `data-wn="${escapeAttr(opts.publicId)}"`,
    `data-theme="${escapeAttr(opts.theme)}"`,
    `data-limit="${escapeAttr(String(opts.widgetLimit))}"`,
  ];
  const title = (opts.title ?? "").trim();
  if (title) {
    parts.push(`data-title="${escapeAttr(title)}"`);
  }
  if (opts.borderless) {
    parts.push(`data-borderless="1"`);
  }
  if (opts.showSummaries === false) {
    parts.push(`data-summaries="0"`);
  }
  if (feed !== base) {
    parts.push(`data-feed-base="${escapeAttr(feed)}"`);
  }
  return (
    `<div ${parts.join(" ")}></div>\n` +
    `<script src="${escapeAttr(`${base}/embed.js`)}" async></script>`
  );
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}
