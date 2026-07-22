import { handlePresence } from "./handlers/presence.ts";
import { handleWidgets } from "./handlers/widgets.ts";
import { serveFeed } from "./lib/feed.ts";
import { refreshDueWidgets } from "./lib/refresh.ts";
import { corsHeaders, error, json } from "./lib/http.ts";
import {
  isPassthroughPath,
  needsHtmlTrailingSlash,
  parseLocalePath,
  withLocalePrefix,
} from "./lib/locale.ts";

const VERSION = "0.6.0";

function isFeedCdnHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "cdn.widget.news" || h.startsWith("cdn.");
}

/**
 * Serve static assets. Locale prefixes are stripped for ASSETS lookup, but
 * trailing-slash redirects must keep /ru|/uk|/en — otherwise:
 *   /ru/admin → ASSETS 307 Location:/admin/ → i18n JS → /ru/admin → loop
 */
async function serveSiteAssets(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (isPassthroughPath(url.pathname)) {
    return env.ASSETS.fetch(req);
  }

  const { locale, assetPath } = parseLocalePath(url.pathname);
  const localePrefixed = assetPath !== url.pathname;

  // Canonicalize directory URLs before ASSETS can emit a locale-stripping 307
  if (needsHtmlTrailingSlash(assetPath)) {
    const destPath = withLocalePrefix(locale, assetPath + "/");
    return Response.redirect(new URL(destPath + url.search, url.origin).toString(), 308);
  }

  const assetUrl = new URL(req.url);
  assetUrl.pathname = assetPath;

  const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), req));

  if (localePrefixed && res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      try {
        const locUrl = new URL(loc, url.origin);
        // Only rewrite same-origin absolute/relative redirects
        const { assetPath: locAsset } = parseLocalePath(locUrl.pathname);
        const fixed = withLocalePrefix(locale, locAsset) + locUrl.search + locUrl.hash;
        return Response.redirect(new URL(fixed, url.origin).toString(), res.status);
      } catch {
        /* keep original */
      }
    }
  }

  return res;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const feedCdn = isFeedCdnHost(url.hostname);

    // CDN host is feed-only (no site HTML / admin)
    if (feedCdn) {
      if (req.method === "OPTIONS" && url.pathname.startsWith("/f/")) {
        return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
      }
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "widget.news-cdn",
          version: VERSION,
          feedMode: "worker-cache-api",
          feedBase: env.FEED_BASE_URL,
        });
      }
      const feedMatch = url.pathname.match(/^\/f\/([A-Za-z0-9_-]+)\.json$/);
      if (feedMatch && req.method === "GET") {
        return serveFeed(req, env, ctx, feedMatch[1]!);
      }
      return error("Not found — feed CDN only serves /f/{id}.json", 404);
    }

    if (
      req.method === "OPTIONS" &&
      (url.pathname.startsWith("/api/") || url.pathname.startsWith("/f/"))
    ) {
      return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
    }

    try {
      // Legacy ?lang=ru → /ru/...
      const qLang = url.searchParams.get("lang");
      if (qLang && (qLang === "en" || qLang === "ru" || qLang === "uk") && req.method === "GET") {
        url.searchParams.delete("lang");
        const { assetPath } = parseLocalePath(url.pathname);
        const dest =
          qLang === "en"
            ? assetPath + (url.search || "")
            : `/${qLang}${assetPath === "/" ? "/" : assetPath}${url.search || ""}`;
        return Response.redirect(new URL(dest, url.origin).toString(), 302);
      }

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "widget.news",
          version: VERSION,
          pipeline: "exa-search",
          hasExaKey: Boolean(env.EXA_API_KEY),
          hasAi: Boolean(env.AI),
          feedBase: env.FEED_BASE_URL,
          feedMode: "worker-cache-api",
        });
      }

      // Embed presence beacon (throttled last_seen + inactive resume)
      const seenMatch = url.pathname.match(/^\/api\/v\/([A-Za-z0-9_-]+)$/);
      if (seenMatch && (req.method === "POST" || req.method === "GET")) {
        return handlePresence(req, env, ctx, seenMatch[1]!);
      }

      if (url.pathname.startsWith("/api/widgets")) {
        const res = await handleWidgets(req, env, ctx);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(corsHeaders(req.headers.get("origin")))) {
          headers.set(k, v);
        }
        return new Response(res.body, { status: res.status, headers });
      }

      // Feed JSON: Cache API → R2 only on miss (same path as cdn host)
      const feedMatch = url.pathname.match(/^\/f\/([A-Za-z0-9_-]+)\.json$/);
      if (feedMatch && req.method === "GET") {
        return serveFeed(req, env, ctx, feedMatch[1]!);
      }

      if (env.ASSETS) {
        return serveSiteAssets(req, env);
      }

      return error("Not found", 404);
    } catch (e) {
      console.error(e);
      return error(e instanceof Error ? e.message : "Internal error", 500);
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      refreshDueWidgets(env)
        .then((r) => console.log("cron refreshDueWidgets", r))
        .catch((e) => console.error("cron refreshDueWidgets failed", e)),
    );
  },
} satisfies ExportedHandler<Env>;
