import * as db from "../lib/db.ts";
import { refreshWidget } from "../lib/refresh.ts";
import { SEEN_TOUCH_MS } from "../lib/schedule.ts";

/**
 * Cheap embed presence beacon.
 * - Cache API throttle (~6h per colo) avoids D1 on hot widgets
 * - D1 touch updates last_seen_at; reactivates inactive → background refresh
 */
export async function handlePresence(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  publicId: string,
): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(null, { status: 405 });
  }

  // Basic id shape (nanoid alphabet)
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(publicId)) {
    return new Response(null, { status: 204 });
  }

  const origin = new URL(req.url).origin;
  const cacheKey = new Request(`${origin}/__seen/${encodeURIComponent(publicId)}`, {
    method: "GET",
  });
  const cache = caches.default;

  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      return presenceResponse();
    }
  } catch {
    /* ignore cache errors */
  }

  // Reserve throttle slot before D1 so concurrent beacons don't all write
  const throttleTtl = Math.floor(SEEN_TOUCH_MS / 1000);
  try {
    const store = new Response("1", {
      status: 200,
      headers: {
        "cache-control": `public, max-age=${throttleTtl}`,
        "cdn-cache-control": `max-age=${throttleTtl}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, store));
  } catch {
    /* ignore */
  }

  ctx.waitUntil(touchAndMaybeRefresh(env, publicId));

  return presenceResponse();
}

function presenceResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });
}

async function touchAndMaybeRefresh(env: Env, publicId: string): Promise<void> {
  try {
    const result = await db.touchWidgetSeen(env.DB, publicId);
    if (result.reactivated && result.widget) {
      await refreshWidget(env, result.widget).catch((e) =>
        console.error("reactivate refresh failed", publicId, e),
      );
    }
  } catch (e) {
    console.error("touchWidgetSeen", publicId, e);
  }
}
