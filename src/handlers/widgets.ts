import * as db from "../lib/db.ts";
import * as exa from "../lib/exa.ts";
import { emptyFeed, feedPresentationFromWidget, readFeed, writeFeed } from "../lib/feed.ts";
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

function parseAuthToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  return new URL(req.url).searchParams.get("token");
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
  row: { admin_token_hash: string },
): Promise<boolean> {
  const token = parseAuthToken(req);
  if (!token) return false;
  if (await isRootToken(token, env)) return true;
  const hash = await sha256Hex(token);
  return timingSafeEqual(hash, row.admin_token_hash);
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

export async function handleWidgets(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  // List: GET /api/widgets?token=  (token-only login, all matching widgets)
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
    return error("Unauthorized — pass Bearer widget access key, root token, or ?token=", 401);
  }

  if (action === "refresh" || action === "sync") {
    if (req.method !== "POST") return error("Method not allowed", 405);
    const key = requireApiKey(env);
    if (key instanceof Response) return key;
    try {
      // Manual refresh also counts as presence and can leave inactive
      if (row.status === "inactive") {
        await db.updateWidgetRow(env.DB, row.id, {
          status: "active",
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      const fresh = (await db.getWidgetById(env.DB, row.id))!;
      const result = await refreshWidget(env, fresh);
      return json(refreshPayload(result));
    } catch (e) {
      return searchError(e, "refresh failed");
    }
  }

  if (req.method === "GET") {
    return json(publicResponse(env, row, req));
  }

  if (req.method === "PATCH") {
    return patchWidget(req, env, row);
  }

  if (req.method === "DELETE") {
    return deleteWidget(env, row);
  }

  return error("Method not allowed", 405);
}

async function listWidgets(req: Request, env: Env): Promise<Response> {
  const token = parseAuthToken(req);
  if (!token) {
    return error("Unauthorized — pass Bearer widget access key, root token, or ?token=", 401);
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

  if (!rows.length) {
    return error(
      scope === "root" ? "No widgets yet" : "No widgets for this access key",
      404,
    );
  }

  return json({
    scope,
    widgets: rows.map((r) => publicResponse(env, r, req)),
  });
}

async function createWidget(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = requireApiKey(env);
  if (key instanceof Response) return key;

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
      created_at: now,
      updated_at: now,
    });
  } catch (e) {
    return error(`Failed to persist widget: ${e instanceof Error ? e.message : e}`, 500);
  }

  const row = (await db.getWidgetById(env.DB, id))!;
  await writeFeed(env.FEEDS, emptyFeed(row));

  // First fill in background (Exa Search + Workers AI summaries)
  ctx.waitUntil(
    refreshWidget(env, row).catch((err) => {
      console.error("initial refresh failed", err);
    }),
  );

  return json(publicResponse(env, row, req, accessToken), 201);
}

async function patchWidget(req: Request, env: Env, row: WidgetRow): Promise<Response> {
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
    if (q !== row.query) {
      queryChanged = true;
      dbFields.query = q;
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
  const updated = (await db.getWidgetById(env.DB, row.id))!;

  // New topic must not be blocked by old novelty history
  if (queryChanged) {
    await deleteNovelty(env.FEEDS, updated.public_id);
  }

  const existing = await readFeed(env.FEEDS, updated.public_id);
  if (existing) {
    await writeFeed(env.FEEDS, {
      ...existing,
      ...feedPresentationFromWidget(updated),
    });
  }

  return json(publicResponse(env, updated, req));
}

async function deleteWidget(env: Env, row: WidgetRow): Promise<Response> {
  await purgeWidgetArtifacts(env, row.public_id);
  await db.deleteWidgetRow(env.DB, row.id);
  return json({ ok: true, deleted: row.id, publicId: row.public_id });
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function searchError(e: unknown, prefix: string): Response {
  if (e instanceof exa.ExaError) {
    let detail = e.body ?? "";
    try {
      const j = JSON.parse(detail) as { message?: string };
      if (j.message) detail = j.message;
    } catch {
      /* keep raw */
    }
    return error(`${prefix}: ${detail || e.message}`, e.status >= 400 && e.status < 600 ? e.status : 502);
  }
  return error(`${prefix}: ${e instanceof Error ? e.message : String(e)}`, 502);
}

