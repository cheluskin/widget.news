import { handleWidgets } from "./handlers/widgets";
import { feedCacheControl, readFeed } from "./lib/feed";
import { reconcileAll } from "./lib/ingest";
import { corsHeaders, error, json } from "./lib/http";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/f/"))) {
      return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
    }

    try {
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "widget.news",
          version: "0.4.0",
          hasExaKey: Boolean(env.EXA_API_KEY),
          hasAi: Boolean(env.AI),
          feedBase: env.FEED_BASE_URL,
        });
      }

      if (url.pathname.startsWith("/api/widgets")) {
        const res = await handleWidgets(req, env, ctx);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(corsHeaders(req.headers.get("origin")))) {
          headers.set(k, v);
        }
        return new Response(res.body, { status: res.status, headers });
      }

      // Feed from R2 (dev + fallback when FEED_BASE_URL points here)
      const feedMatch = url.pathname.match(/^\/f\/([A-Za-z0-9_-]+)\.json$/);
      if (feedMatch && req.method === "GET") {
        const publicId = feedMatch[1]!;
        const snap = await readFeed(env.FEEDS, publicId);
        if (!snap) {
          return new Response(JSON.stringify({ error: "Feed not found" }), {
            status: 404,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "access-control-allow-origin": "*",
            },
          });
        }
        const cc = feedCacheControl(snap.items?.length ?? 0);
        return new Response(JSON.stringify(snap), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": cc,
            "access-control-allow-origin": "*",
            "cdn-cache-control":
              (snap.items?.length ?? 0) <= 0 ? "max-age=0, must-revalidate" : "public, max-age=300",
          },
        });
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(req);
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
      reconcileAll(env)
        .then((r) => console.log("cron reconcile", r))
        .catch((e) => console.error("cron reconcile failed", e)),
    );
  },
} satisfies ExportedHandler<Env>;
