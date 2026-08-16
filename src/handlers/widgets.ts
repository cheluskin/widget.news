import * as db from "../lib/db.ts";
import * as exa from "../lib/exa.ts";
import {
  emptyFeed,
  feedPresentationFromWidget,
  purgeFeedCache,
  readFeed,
  writeFeed,
} from "../lib/feed.ts";
import { nanoid, randomToken, sha256Hex, timingSafeEqual } from "../lib/ids.ts";
import { purgeWidgetArtifacts, refreshWidget } from "../lib/refresh.ts";
import { deleteNovelty } from "../lib/novelty.ts";
import { error, json } from "../lib/http.ts";
import { adminUrl, embedOptsFromRow, embedSnippet, feedUrl, publicBase } from "../lib/urls.ts";
import type { CreateWidgetBody, PatchWidgetBody, Period, Theme, WidgetRow } from "../lib/types.ts";
import { asBool, isThemeInput, isUserStatus, normalizeTheme } from "../lib/types.ts";

const PERIODS = new Set<Period>(["1h", "6h", "1d", "7d"]);

function requireApiKey(env: Env): string | Response {
  if (!env.EXA_API_KEY) {
    return error("EXA_API_KEY is not configured. Set wrangler secret or .dev.vars", 503);
  }
  return env.EXA_API_KEY;
}

/**
 * API auth is Bearer-only: the client access key / root token must travel in
 * the Authorization header. Query-string-style token login is never accepted —
 * a token in a URL leaks into server logs and is shared via browser referrers.
 */
function parseAuthToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const token = h.slice(7).trim();
  // Reject an empty/whitespace bearer ("" or "Bearer  ").
  return token ? token : null;
}

/**
 * Root token — full system control (all widgets).
 * Widget token (admin_token_hash) — client access key for that widget’s
 * settings/stats; several widgets may share one client key.
 */
async function isRootToken(token: string, env: Env): Promise<boolean> {
  const root = (env.ROOT_TOKEN || "").trim();
  if (!root || !token) return false;
  return timingSafeEqual(token, root);
}

async function assertAdminWithEnv(
  req: Request,
  env: Env,
  row: { admin_token_hash: string | null | undefined },
): Promise<boolean> {
  const token = parseAuthToken(req);
  if (!token) return false;
  if (await isRootToken(token, env)) return true;
  const hash = await sha256Hex(token);
  // Guard against null/undefined/empty/whitespace or anomalous legacy hashes:
  // a missing stored hash must never pass (timingSafeEqual would coerce/compare
  // against a non-string and silently allow).
  const stored = row.admin_token_hash;
  if (typeof stored !== "string" || !stored.trim()) return false;
  return timingSafeEqual(hash, stored);
}

function publicResponse(env: Env, row: WidgetRow, req: Request, accessToken?: string) {
  const base = publicBase(env, req);
  const title = row.name;
  return {
    id: row.id,
    publicId: row.public_id,
    title,
    /** @deprecated use title */
    name: title,
    query: row.query,
    period: row.period,
    numResults: row.num_results,
    widgetLimit: row.widget_limit,
    theme: normalizeTheme(row.theme),
    status: row.status,
    borderless: asBool(row.borderless, false),
    showSummaries: asBool(row.show_summaries, true),
    lastRunId: row.last_run_id,
    lastSyncedAt: row.last_synced_at,
    lastSeenAt: row.last_seen_at,
    feedUrl: feedUrl(env, row.public_id, req),
    embed: embedSnippet(env, embedOptsFromRow(row), req),
    /** Dashboard URL for this client access key (settings / stats). */
    adminUrl: accessToken ? adminUrl(env, row.public_id, accessToken, req) : undefined,
    /** Client access key — only returned at create time. */
    accessToken: accessToken ?? undefined,
    /** @deprecated use accessToken */
    adminToken: accessToken ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    baseUrl: base,
  };
}

/** Shape returned by POST …/refresh (and legacy …/sync). */
function refreshPayload(result: Awaited<ReturnType<typeof refreshWidget>>) {
  return {
    ok: true,
    refreshed: result.refreshed,
    /** @deprecated alias for clients that still read `synced` */
    synced: result.refreshed,
    runId: result.runId,
    itemCount: result.itemCount,
    addedFromRun: result.addedFromRun,
    droppedDupes: result.droppedDupes,
    reason: result.reason,
  };
}

function resolveTitle(body: { title?: string; name?: string }): string | null | undefined {
  if (body.title !== undefined) return body.title.trim().slice(0, 120) || null;
  if (body.name !== undefined) return body.name.trim().slice(0, 120) || null;
  return undefined;
}

/**
 * Structured error boundary for the widgets API. Any unexpected rejection
 * inside route dispatch or a D1 operation is caught here and turned into a
 * stable, non-sensitive JSON 503 instead of leaking a bare exception (or raw
 * D1 error message). Refresh/patch compensation catches live inside
 * handleWidgetsUnsafe and still run first.
 */
export async function handleWidgets(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    return await handleWidgetsUnsafe(req, env, ctx);
  } catch (e) {
    console.error("handleWidgets failed", {
      method: req.method,
      path: new URL(req.url).pathname,
      error: e,
    });
    return error("Database or service temporarily unavailable", 503);
  }
}

async function handleWidgetsUnsafe(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  // List: GET /api/widgets (Bearer client key / ROOT_TOKEN → all matching widgets)
  if (req.method === "GET" && path === "/api/widgets") {
    return listWidgets(req, env);
  }

  if (req.method === "POST" && path === "/api/widgets") {
    return createWidget(req, env, ctx);
  }

  // /refresh is canonical; /sync is a legacy alias (same Search pipeline).
  const m = path.match(/^\/api\/widgets\/([^/]+)(?:\/(refresh|sync))?$/);
  if (!m) return error("Not found", 404);

  const idOrPublic = m[1]!;
  const action = m[2];

  const row =
    (await db.getWidgetById(env.DB, idOrPublic)) ??
    (await db.getWidgetByPublicId(env.DB, idOrPublic));
  if (!row) return error("Widget not found", 404);

  if (!(await assertAdminWithEnv(req, env, row))) {
    return error("Unauthorized — pass a Bearer widget access key or root token", 401);
  }

  if (action === "refresh" || action === "sync") {
    if (req.method !== "POST") return error("Method not allowed", 405);
    const key = requireApiKey(env);
    if (key instanceof Response) return key;
    try {
      // Manual refresh: run against an in-memory active snapshot so an inactive
      // widget isn't permanently reactivated before the refresh has succeeded.
      // Any successful run is explicit owner activity: persist a fresh
      // last_seen for both active and inactive widgets, and flip to active only
      // when it was inactive. A failed refresh (refreshed !== true) touches
      // nothing.
      const snapshot = row.status === "inactive" ? { ...row, status: "active" as const } : row;
      const result = await refreshWidget(env, snapshot);
      if (result.refreshed) {
        // Persist presence best-effort: the refresh already succeeded, so a
        // presence-write failure must not turn it into an error. A failed
        // refresh (refreshed !== true) never touches presence.
        try {
          const persisted: Parameters<typeof db.updateWidgetRow>[2] = {
            last_seen_at: new Date().toISOString(),
          };
          if (row.status === "inactive") persisted.status = "active";
          await db.updateWidgetRow(env.DB, row.id, persisted);
        } catch (e) {
          console.error("refresh presence persist failed", {
            runId: result.runId,
            widgetId: row.id,
            error: e,
          });
        }
      }
      return json(refreshPayload(result));
    } catch (e) {
      return searchError(e, "refresh failed");
    }
  }

  if (req.method === "GET") {
    return json(publicResponse(env, row, req));
  }

  if (req.method === "PATCH") {
    return patchWidget(req, env, ctx, row);
  }

  if (req.method === "DELETE") {
    return deleteWidget(env, row);
  }

  return error("Method not allowed", 405);
}

async function listWidgets(req: Request, env: Env): Promise<Response> {
  const token = parseAuthToken(req);
  if (!token) {
    return error("Unauthorized — pass a Bearer widget access key or root token", 401);
  }

  let rows: WidgetRow[];
  let scope: "root" | "client" = "client";
  if (await isRootToken(token, env)) {
    // Root: full system control
    scope = "root";
    rows = await db.listAllWidgets(env.DB, 200);
  } else {
    // Client access key: all widgets bound to this token
    const hash = await sha256Hex(token);
    rows = await db.listWidgetsByTokenHash(env.DB, hash, 50);
  }

  return json({
    scope,
    widgets: rows.map((r) => publicResponse(env, r, req)),
  });
}

const CREATE_RATE_LIMIT = 8;
const CREATE_RATE_WINDOW_S = 3600;

/** Best-effort per-IP create cap. Fail-open if Cache API is unavailable. */
async function allowCreate(req: Request): Promise<boolean> {
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const key = new Request(`https://widget.news/__rl/create/${encodeURIComponent(ip)}`);
  try {
    const cache = caches.default;
    const hit = await cache.match(key);
    const n = hit ? Number(await hit.text()) || 0 : 0;
    if (n >= CREATE_RATE_LIMIT) return false;
    await cache.put(
      key,
      new Response(String(n + 1), {
        headers: { "cache-control": `max-age=${CREATE_RATE_WINDOW_S}` },
      }),
    );
    return true;
  } catch {
    return true;
  }
}

async function createWidget(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = requireApiKey(env);
  if (key instanceof Response) return key;
  if (!(await allowCreate(req))) {
    return error("Too many widgets created from this network. Try again later.", 429);
  }

  let body: CreateWidgetBody;
  try {
    body = (await req.json()) as CreateWidgetBody;
  } catch {
    return error("Invalid JSON body");
  }

  const query = (body.query ?? "").trim();
  if (query.length < 3) return error("query must be at least 3 characters");
  if (query.length > 2000) return error("query too long");

  const period: Period = body.period && PERIODS.has(body.period) ? body.period : "1d";
  const numResults = clampInt(body.numResults, 1, 20, 10);
  const widgetLimit = clampInt(body.widgetLimit, 1, 50, 5);
  const theme: Theme = isThemeInput(body.theme) ? normalizeTheme(body.theme) : "site";
  const title = resolveTitle(body);
  const name = title === undefined ? null : title;
  const borderless = body.borderless === true ? 1 : 0;
  const showSummaries = body.showSummaries === false ? 0 : 1;

  // Client access key: reuse if provided (several widgets under one key), else mint new
  const reused = (body.accessToken ?? "").trim();
  if (reused && (reused.length < 16 || reused.length > 200)) {
    return error("accessToken must be 16–200 characters");
  }
  const accessToken = reused || randomToken(24);
  const accessTokenHash = await sha256Hex(accessToken);

  const id = nanoid(16);
  const publicId = nanoid(12);
  const now = new Date().toISOString();

  try {
    await db.insertWidget(env.DB, {
      id,
      public_id: publicId,
      admin_token_hash: accessTokenHash,
      name,
      query,
      period,
      num_results: numResults,
      widget_limit: widgetLimit,
      theme,
      status: "active",
      borderless,
      show_summaries: showSummaries,
      // Builder/admin preview uses data-no-ping — seed presence at create
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    });
  } catch (e) {
    console.error("widget insert failed", { widgetId: id, publicId, error: e });
    return error("Failed to persist widget", 500);
  }

  const row = await db.getWidgetById(env.DB, id);
  if (!row) {
    return error("Widget created but could not be loaded", 500);
  }

  try {
    await writeFeed(env.FEEDS, emptyFeed(row));
  } catch (e) {
    // Initial R2 seed failed before the one-time token was returned: the row
    // would be persisted but inaccessible. Roll the D1 row back so no orphaned
    // widget is left behind. If cleanup itself fails, log it but keep returning
    // the fixed, non-sensitive feed failure (never interpolate the raw error).
    try {
      await db.deleteWidgetRow(env.DB, id);
    } catch (cleanupErr) {
      console.error("feed seed rollback failed", {
        widgetId: id,
        publicId,
        seedError: e,
        rollbackError: cleanupErr,
      });
    }
    console.error("feed seed failed", { widgetId: id, publicId, error: e });
    return error("Failed to initialize widget feed", 502);
  }

  // First fill in background (Exa Search + Workers AI summaries)
  ctx.waitUntil(
    refreshWidget(env, row).catch((err) => {
      console.error("initial refresh failed", err);
    }),
  );

  return json(publicResponse(env, row, req, accessToken), 201);
}

async function patchWidget(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  row: WidgetRow,
): Promise<Response> {
  let body: PatchWidgetBody;
  try {
    body = (await req.json()) as PatchWidgetBody;
  } catch {
    return error("Invalid JSON body");
  }

  const dbFields: Parameters<typeof db.updateWidgetRow>[2] = {
    updated_at: new Date().toISOString(),
  };

  const title = resolveTitle(body);
  if (title !== undefined) {
    dbFields.name = title;
  }
  let queryChanged = false;
  if (body.query !== undefined) {
    const q = body.query.trim();
    if (q.length < 3) return error("query must be at least 3 characters");
    if (q.length > 2000) return error("query too long");
    if (q !== row.query) {
      queryChanged = true;
      dbFields.query = q;
      // Force the next cron/manual window to treat this as a first fill.
      dbFields.last_synced_at = null;
    }
  }
  if (body.numResults !== undefined) {
    dbFields.num_results = clampInt(body.numResults, 1, 20, row.num_results);
  }
  if (body.period !== undefined) {
    if (body.period === null) {
      // null period → keep current; client should use paused status instead
    } else if (PERIODS.has(body.period)) {
      dbFields.period = body.period;
    } else {
      return error("invalid period");
    }
  }
  if (body.widgetLimit !== undefined) {
    dbFields.widget_limit = clampInt(body.widgetLimit, 1, 50, row.widget_limit);
  }
  if (body.theme !== undefined) {
    if (!isThemeInput(body.theme)) return error("invalid theme");
    dbFields.theme = normalizeTheme(body.theme);
  }
  if (body.borderless !== undefined) {
    dbFields.borderless = body.borderless ? 1 : 0;
  }
  if (body.showSummaries !== undefined) {
    dbFields.show_summaries = body.showSummaries ? 1 : 0;
  }
  if (body.status !== undefined) {
    if (!isUserStatus(body.status)) {
      return error("invalid status — use active or paused");
    }
    dbFields.status = body.status;
    // User reactivating also refreshes presence so cron keeps serving
    if (body.status === "active") {
      dbFields.last_seen_at = new Date().toISOString();
    }
  }

  await db.updateWidgetRow(env.DB, row.id, dbFields);
  const updated = await db.getWidgetById(env.DB, row.id);
  // A missing row right after the update is a concurrent delete — do not write
  // a feed for a row that no longer exists.
  if (!updated) {
    return error("Widget not found", 404);
  }

  // Essential R2 write: keep the served feed consistent with the new DB state.
  // Query change resets to an empty feed (old-topic items must not be served);
  // otherwise rewrite presentation when a snapshot exists; an absent feed needs
  // no write. If this fails, roll D1 back to the exact prior row so the two
  // stores don't diverge.
  try {
    if (queryChanged) {
      await writeFeed(env.FEEDS, emptyFeed(updated));
    } else {
      const existing = await readFeed(env.FEEDS, updated.public_id);
      if (existing) {
        await writeFeed(env.FEEDS, {
          ...existing,
          ...feedPresentationFromWidget(updated),
        });
      }
    }
  } catch (e) {
    try {
      await db.updateWidgetRow(env.DB, row.id, {
        name: row.name,
        query: row.query,
        period: row.period,
        num_results: row.num_results,
        widget_limit: row.widget_limit,
        theme: row.theme,
        status: row.status,
        borderless: row.borderless,
        show_summaries: row.show_summaries,
        last_seen_at: row.last_seen_at,
        last_synced_at: row.last_synced_at,
        updated_at: row.updated_at,
      });
      return error("Failed to update feed", 502);
    } catch (compErr) {
      console.error("feed update failed and D1 compensation failed", {
        feedError: e,
        rollbackError: compErr,
        widgetId: row.id,
      });
      return error("Widget update left in inconsistent state", 500);
    }
  }

  // Best-effort cleanup after the essential rewrite succeeded.
  if (queryChanged) {
    try {
      // The empty feed plus the changed query already prevent old items being
      // served, so a novelty reset failure should not undo visible consistency.
      await deleteNovelty(env.FEEDS, updated.public_id);
    } catch (e) {
      console.error("novelty reset failed after query change", e);
    }
  }
  try {
    // Cache cleanup can't be transactional across PoPs; a failed purge only
    // delays consistency to the edge/CDN TTL.
    await purgeFeedCache(env, updated.public_id);
  } catch (e) {
    console.error("feed cache purge failed", e);
  }

  if (queryChanged) {
    ctx.waitUntil(
      refreshWidget(env, updated).catch((err) => {
        console.error("query-change refresh failed", { widgetId: updated.id, error: err });
      }),
    );
  }

  return json(publicResponse(env, updated, req));
}

async function deleteWidget(env: Env, row: WidgetRow): Promise<Response> {
  // D1 is the source of truth: delete the row FIRST so the widget can no longer
  // be routed or scheduled. A failure here propagates to the exported wrapper,
  // which returns a structured 503, and no artifacts are purged (the widget is
  // still live). Artifact cleanup after a successful D1 delete is best-effort:
  // a failure is logged but still returns success because the row is gone.
  await db.deleteWidgetRow(env.DB, row.id);
  try {
    await purgeWidgetArtifacts(env, row.public_id);
  } catch (e) {
    console.error("widget artifact purge failed after delete", {
      widgetId: row.id,
      publicId: row.public_id,
      error: e,
    });
  }
  return json({ ok: true, deleted: row.id, publicId: row.public_id });
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  // Only finite numbers and non-empty, finite numeric strings are accepted.
  // null, undefined, booleans, empty/whitespace strings, and any other type
  // (objects, arrays, etc.) fall back instead of being coerced (which would
  // silently map e.g. `""` or `false` to 0).
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
  }
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function searchError(e: unknown, prefix: string): Response {
  if (e instanceof exa.ExaError) {
    const status = e.status === 429 ? 429 : 502;
    const detail = status === 429 ? "search rate limited" : "search unavailable";
    return error(`${prefix}: ${detail}`, status);
  }
  return error(`${prefix}: search unavailable`, 502);
}

