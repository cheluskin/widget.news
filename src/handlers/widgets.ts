import * as db from "../lib/db";
import * as exa from "../lib/exa";
import { emptyFeed, readFeed, writeFeed } from "../lib/feed";
import { nanoid, randomToken, sha256Hex, timingSafeEqual } from "../lib/ids";
import { purgeWidgetArtifacts, refreshWidget } from "../lib/ingest";
import { deleteNovelty } from "../lib/novelty";
import { error, json } from "../lib/http";
import { adminUrl, embedSnippet, feedUrl, publicBase } from "../lib/urls";
import type { CreateWidgetBody, PatchWidgetBody, Period, Theme, WidgetRow } from "../lib/types";

const PERIODS = new Set<Period>(["1h", "6h", "1d", "7d"]);
const THEMES = new Set<Theme>(["light", "dark", "auto"]);

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

async function assertAdmin(req: Request, row: { admin_token_hash: string }): Promise<boolean> {
  const token = parseAuthToken(req);
  if (!token) return false;
  const hash = await sha256Hex(token);
  return timingSafeEqual(hash, row.admin_token_hash);
}

function publicResponse(env: Env, row: WidgetRow, req: Request, adminToken?: string) {
  const base = publicBase(env, req);
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    query: row.query,
    period: row.period,
    numResults: row.num_results,
    widgetLimit: row.widget_limit,
    theme: row.theme,
    status: row.status,
    lastRunId: row.last_run_id,
    lastSyncedAt: row.last_synced_at,
    feedUrl: feedUrl(env, row.public_id, req),
    embed: embedSnippet(
      env,
      { publicId: row.public_id, theme: row.theme, widgetLimit: row.widget_limit },
      req,
    ),
    adminUrl: adminToken ? adminUrl(env, row.public_id, adminToken, req) : undefined,
    adminToken: adminToken ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    baseUrl: base,
  };
}

export async function handleWidgets(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (req.method === "POST" && path === "/api/widgets") {
    return createWidget(req, env, ctx);
  }

  const m = path.match(/^\/api\/widgets\/([^/]+)(?:\/(refresh|sync))?$/);
  if (!m) return error("Not found", 404);

  const idOrPublic = m[1]!;
  const action = m[2];

  const row =
    (await db.getWidgetById(env.DB, idOrPublic)) ??
    (await db.getWidgetByPublicId(env.DB, idOrPublic));
  if (!row) return error("Widget not found", 404);

  if (!(await assertAdmin(req, row))) {
    return error("Unauthorized — pass Bearer admin token or ?token=", 401);
  }

  // refresh + sync both run Exa Search + AI summarize (sync kept for UI compat)
  if (action === "refresh" || action === "sync") {
    if (req.method !== "POST") return error("Method not allowed", 405);
    const key = requireApiKey(env);
    if (key instanceof Response) return key;
    try {
      const result = await refreshWidget(env, row);
      return json({ ok: true, ...result });
    } catch (e) {
      return exaError(e, action === "refresh" ? "refresh failed" : "sync failed");
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
  const theme: Theme = body.theme && THEMES.has(body.theme) ? body.theme : "auto";
  const name = body.name?.trim().slice(0, 120) || null;

  const id = nanoid(16);
  const publicId = nanoid(12);
  const adminToken = randomToken(24);
  const adminTokenHash = await sha256Hex(adminToken);
  const now = new Date().toISOString();

  try {
    await db.insertWidget(env.DB, {
      id,
      public_id: publicId,
      admin_token_hash: adminTokenHash,
      name,
      query,
      period,
      num_results: numResults,
      widget_limit: widgetLimit,
      theme,
      status: "active",
      created_at: now,
      updated_at: now,
    });
  } catch (e) {
    return error(`Failed to persist widget: ${e instanceof Error ? e.message : e}`, 500);
  }

  const row = (await db.getWidgetById(env.DB, id))!;
  await writeFeed(env.FEEDS, emptyFeed(row));

  // First fill in background (search + CF AI summaries)
  ctx.waitUntil(
    refreshWidget(env, row).catch((err) => {
      console.error("initial refresh failed", err);
    }),
  );

  return json(publicResponse(env, row, req, adminToken), 201);
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

  if (body.name !== undefined) {
    dbFields.name = body.name.trim().slice(0, 120) || null;
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
    if (!THEMES.has(body.theme)) return error("invalid theme");
    dbFields.theme = body.theme;
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "paused") return error("invalid status");
    dbFields.status = body.status;
  }

  await db.updateWidgetRow(env.DB, row.id, dbFields);
  const updated = (await db.getWidgetById(env.DB, row.id))!;

  // New topic must not be blocked by old run history
  if (queryChanged) {
    await deleteNovelty(env.FEEDS, updated.public_id);
  }

  const existing = await readFeed(env.FEEDS, updated.public_id);
  if (existing) {
    await writeFeed(env.FEEDS, {
      ...existing,
      query: updated.query,
      theme: updated.theme,
      widgetLimit: updated.widget_limit,
      updatedAt: new Date().toISOString(),
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

function exaError(e: unknown, prefix: string): Response {
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
