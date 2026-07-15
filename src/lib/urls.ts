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
  return `${feedBase(env, req)}/f/${publicId}.json`;
}

export function adminUrl(env: Env, publicId: string, adminToken: string, req?: Request): string {
  const base = publicBase(env, req);
  return `${base}/admin/?id=${encodeURIComponent(publicId)}&token=${encodeURIComponent(adminToken)}`;
}

export function embedSnippet(
  env: Env,
  opts: { publicId: string; theme: string; widgetLimit: number },
  req?: Request,
): string {
  const base = publicBase(env, req);
  const feed = feedBase(env, req);
  const feedAttr = feed !== base ? ` data-feed-base="${feed}"` : "";
  return (
    `<div data-wn="${opts.publicId}" data-theme="${opts.theme}" data-limit="${opts.widgetLimit}"${feedAttr}></div>\n` +
    `<script src="${base}/embed.js" async></script>`
  );
}
