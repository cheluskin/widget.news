/**
 * Coverage for v0.6: title/appearance, presence/inactive, auth (ROOT + client key),
 * permanent localStorage session, feed presentation, UI contracts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_FEED_CAP,
  emptyFeed,
  feedPresentationFromWidget,
  feedKey,
  hitToItem,
  mergeHitsIntoFeedLocked,
  purgeFeedCache,
  readFeed,
  serveFeed,
} from "../src/lib/feed.ts";
import {
  DEFAULT_CRON_CONCURRENCY,
  DEFAULT_CRON_WIDGET_LIMIT,
  MAX_EXA_RESULTS,
  OVERFETCH_MIN_HEADROOM,
  OVERFETCH_MULTIPLIER,
} from "../src/lib/refresh.ts";
import { filterNovelResults } from "../src/lib/novelty.ts";
import {
  INACTIVE_AFTER_MS,
  INACTIVE_GRACE_MS,
  SEEN_TOUCH_MS,
  shouldMarkInactive,
} from "../src/lib/schedule.ts";
import {
  adminUrl,
  embedOptsFromRow,
  embedSnippet,
  feedUrl,
  publicBase,
  type EmbedOpts,
} from "../src/lib/urls.ts";
import { asBool, isUserStatus, normalizeTheme, type SearchHit, type WidgetRow } from "../src/lib/types.ts";
import { handleWidgets } from "../src/handlers/widgets.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function sampleRow(over: Partial<WidgetRow> = {}): WidgetRow {
  return {
    id: "id1",
    public_id: "pub1",
    admin_token_hash: "hash",
    name: "My Title",
    query: "climate news",
    period: "1d",
    num_results: 10,
    widget_limit: 5,
    theme: "site",
    status: "active",
    borderless: 0,
    show_summaries: 1,
    last_run_id: null,
    last_synced_at: null,
    last_seen_at: null,
    sync_locked_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("asBool", () => {
  it("maps sqlite integers and strings", () => {
    assert.equal(asBool(1), true);
    assert.equal(asBool(0), false);
    assert.equal(asBool("1"), true);
    assert.equal(asBool("0"), false);
    assert.equal(asBool(true), true);
    assert.equal(asBool(false), false);
    assert.equal(asBool(undefined, true), true);
    assert.equal(asBool(null, false), false);
    assert.equal(asBool("x", true), true);
  });
});

describe("status helpers", () => {
  it("user may only set active|paused", () => {
    assert.equal(isUserStatus("active"), true);
    assert.equal(isUserStatus("paused"), true);
    assert.equal(isUserStatus("inactive"), false);
    assert.equal(isUserStatus("deleted"), false);
  });
});

describe("inactive lifecycle constants", () => {
  it("grace 7d, inactive 14d, seen throttle 6h", () => {
    assert.equal(INACTIVE_GRACE_MS, 7 * 24 * 60 * 60 * 1000);
    assert.equal(INACTIVE_AFTER_MS, 14 * 24 * 60 * 60 * 1000);
    assert.equal(SEEN_TOUCH_MS, 6 * 60 * 60 * 1000);
  });

  it("shouldMarkInactive edge cases", () => {
    const now = Date.parse("2026-07-18T00:00:00.000Z");
    // invalid created → not inactive
    assert.equal(shouldMarkInactive("not-a-date", null, now), false);
    // still inside grace (1ms short of boundary)
    assert.equal(
      shouldMarkInactive(new Date(now - INACTIVE_GRACE_MS + 1).toISOString(), null, now),
      false,
    );
    // at/past grace boundary (now - created >= grace)
    assert.equal(
      shouldMarkInactive(new Date(now - INACTIVE_GRACE_MS).toISOString(), null, now),
      true,
    );
    // invalid last_seen string → treat as never seen → inactive if past grace
    assert.equal(
      shouldMarkInactive(
        new Date(now - INACTIVE_GRACE_MS - 1).toISOString(),
        "bogus",
        now,
      ),
      true,
    );
    // exactly at inactive threshold → inactive (>=)
    assert.equal(
      shouldMarkInactive(
        new Date(now - INACTIVE_GRACE_MS - 1).toISOString(),
        new Date(now - INACTIVE_AFTER_MS).toISOString(),
        now,
      ),
      true,
    );
  });
});

describe("feed presentation", () => {
  it("feedKey matches CDN path", () => {
    assert.equal(feedKey("abc"), "f/abc.json");
  });

  it("emptyFeed includes title and appearance defaults", () => {
    const feed = emptyFeed(sampleRow({ name: null, borderless: 1, show_summaries: 0 }));
    assert.equal(feed.title, null);
    assert.equal(feed.borderless, true);
    assert.equal(feed.showSummaries, false);
    assert.equal(feed.theme, "site");
  });

  it("feedPresentationFromWidget mirrors widget fields", () => {
    const p = feedPresentationFromWidget(
      sampleRow({ name: "T", theme: "dark", widget_limit: 8, borderless: 1, show_summaries: 0 }),
    );
    assert.equal(p.title, "T");
    assert.equal(p.theme, "dark");
    assert.equal(p.widgetLimit, 8);
    assert.equal(p.borderless, true);
    assert.equal(p.showSummaries, false);
    assert.ok(p.updatedAt);
  });
});

describe("urls / embed opts", () => {
  const env = {
    PUBLIC_BASE_URL: "https://widget.news",
    FEED_BASE_URL: "https://cdn.widget.news",
  } as Env;

  it("adminUrl embeds token via a fragment (never a query) for first-time deep link", () => {
    const u = adminUrl(env, "pub", "secret-token-xyz");
    assert.equal(u, "https://widget.news/admin/#token=secret-token-xyz");
  });

  it("feedUrl uses CDN base", () => {
    assert.equal(feedUrl(env, "pid"), "https://cdn.widget.news/f/pid.json");
  });

  it("feedUrl percent-encodes publicId", () => {
    assert.equal(
      feedUrl(env, "a b/c?d&e"),
      "https://cdn.widget.news/f/a%20b%2Fc%3Fd%26e.json",
    );
  });

  it("publicBase falls back for local config when request present", () => {
    const localEnv = {
      PUBLIC_BASE_URL: "http://localhost:8787",
      FEED_BASE_URL: "http://localhost:8787",
    } as Env;
    const req = new Request("https://preview.example/path");
    assert.equal(publicBase(localEnv, req), "https://preview.example");
  });

  it("embedOptsFromRow maps DB row", () => {
    const opts = embedOptsFromRow(
      sampleRow({ name: "Hi", theme: "light", widget_limit: 3, borderless: 1, show_summaries: 0 }),
    );
    assert.deepEqual(opts, {
      publicId: "pub1",
      theme: "light",
      widgetLimit: 3,
      title: "Hi",
      borderless: true,
      showSummaries: false,
    });
  });

  it("embedSnippet from row opts", () => {
    const snip = embedSnippet(env, embedOptsFromRow(sampleRow({ name: "N", borderless: 1 })));
    assert.match(snip, /data-title="N"/);
    assert.match(snip, /data-borderless="1"/);
    assert.doesNotMatch(snip, /data-summaries=/);
  });

  it("embedSnippet escapes every dynamic attribute", () => {
    const opts: EmbedOpts = {
      publicId: `p"'<>`,
      theme: `t"'<>`,
      widgetLimit: 3,
      title: `T"'<>`,
      showSummaries: false,
    };
    const snip = embedSnippet(env, opts);
    assert.match(snip, /data-wn="p&quot;&#39;&lt;&gt;"/);
    assert.match(snip, /data-theme="t&quot;&#39;&lt;&gt;"/);
    assert.match(snip, /data-limit="3"/);
    assert.match(snip, /data-title="T&quot;&#39;&lt;&gt;"/);
    assert.match(snip, /data-feed-base="https:\/\/cdn\.widget\.news"/);
    assert.match(snip, /data-summaries="0"/);
    // No raw quote/< left unescaped in the snippet.
    assert.doesNotMatch(snip, /[<>]"/);
    assert.match(snip, /<script src="https:\/\/widget\.news\/embed\.js" async><\/script>/);
  });
});

describe("feed read & serve", () => {
  let prevCaches: unknown;

  beforeEach(() => {
    prevCaches = (globalThis as Record<string, unknown>).caches;
  });

  afterEach(() => {
    if (prevCaches === undefined) {
      delete (globalThis as Record<string, unknown>).caches;
    } else {
      (globalThis as Record<string, unknown>).caches = prevCaches;
    }
  });

  it("readFeed returns null on malformed/rejected json", async () => {
    const bucket = {
      get: async () => ({ json: async () => Promise.reject(new Error("bad json")) }),
    } as unknown as R2Bucket;
    assert.equal(await readFeed(bucket, "pub1"), null);
  });

  it("missing feed is non-cacheable and not inserted into Cache API", async () => {
    const puts: string[] = [];
    (globalThis as Record<string, unknown>).caches = {
      default: {
        match: async () => undefined,
        put: async (req: Request) => {
          puts.push(req.url);
        },
      },
    };
    const bucket = { get: async () => null } as unknown as R2Bucket;
    const ctx = { waitUntil: () => Promise.resolve() } as unknown as ExecutionContext;
    const res = await serveFeed(
      new Request("https://widget.news/f/missing.json"),
      { FEEDS: bucket },
      ctx,
      "missing",
    );
    assert.equal(res.status, 404);
    const cc = res.headers.get("cache-control") ?? "";
    assert.match(cc, /no-store/);
    assert.equal(puts.length, 0, "404 must not be written to Cache API");
  });
});

describe("schema & migrate", () => {
  it("schema has last_seen, borderless, show_summaries, indexes", () => {
    const schema = read("src/db/schema.sql");
    assert.match(schema, /borderless INTEGER/);
    assert.match(schema, /show_summaries INTEGER/);
    assert.match(schema, /last_seen_at TEXT/);
    assert.match(schema, /idx_widgets_token_hash/);
    assert.match(schema, /idx_widgets_last_seen/);
  });

  it("migrate.sql adds v0.6 columns and seeds last_seen fresh", () => {
    const m = read("src/db/migrate.sql");
    assert.match(m, /borderless/);
    assert.match(m, /show_summaries/);
    assert.match(m, /last_seen_at/);
    // Seed uses a fresh observation window as strftime UTC ISO (same sortable
    // shape as app Date.toISOString() values), NOT CURRENT_TIMESTAMP whose
    // space-separated form doesn't sort against app ISO strings.
    assert.match(m, /SET last_seen_at = strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/);
    assert.doesNotMatch(m, /SET last_seen_at = CURRENT_TIMESTAMP/);
    assert.match(m, /WHERE last_seen_at IS NULL/);
    // v0.3.1 ALTER is documented historical and not executable here
    assert.match(m, /v0\.3\.1.*HISTORICAL/s);
    assert.doesNotMatch(m, /^ALTER TABLE widgets ADD COLUMN sync_locked_at/m);
    // Must not claim the whole upgrade is safely re-runnable
    assert.doesNotMatch(m, /Safe to re-run/s);
    // Exactly one transaction block wraps the v0.6 ALTERs + seed + indexes so
    // D1 applies them atomically (wrangler strips one outer transaction).
    assert.match(m, /BEGIN TRANSACTION;/);
    assert.match(m, /COMMIT;/);
    assert.equal((m.match(/BEGIN TRANSACTION;/g) ?? []).length, 1);
    assert.equal((m.match(/COMMIT;/g) ?? []).length, 1);
    // Normalization in migrate guards the exact legacy shape: GLOB digit
    // classes on each position plus strict 19-char length.
    assert.match(m, /GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\] \[0-9\]\[0-9\]:\[0-9\]\[0-9\]:\[0-9\]\[0-9\]'/);
    assert.match(m, /length\(last_seen_at\)\s*=\s*19/);
    // Semantic round-trip guard: only a real calendar datetime (reformatting to
    // `%Y-%m-%d %H:%M:%S` yields the identical string) survives normalization.
    // Invalid days/months/hours are left untouched.
    assert.match(m, /strftime\('%Y-%m-%d %H:%M:%S', last_seen_at\)\s*=\s*last_seen_at/);
    // Target normalization keeps the exact UTC-ISO shape (with %H for hours).
    assert.match(m, /strftime\('%Y-%m-%dT%H:%M:%fZ', last_seen_at\)/);
  });

  it("backfill-last-seen seeds NULL and normalizes legacy with strftime ISO", () => {
    const b = read("src/db/backfill-last-seen.sql");
    // Seeds NULL only with strftime UTC ISO, never CURRENT_TIMESTAMP
    assert.match(b, /SET last_seen_at = strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/);
    assert.match(b, /WHERE last_seen_at IS NULL/);
    // Normalizes ONLY the exact legacy 19-char `YYYY-MM-DD HH:MM:SS` shape via
    // GLOB digit classes + strict length guard; arbitrary space text untouched.
    assert.match(b, /GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\] \[0-9\]\[0-9\]:\[0-9\]\[0-9\]:\[0-9\]\[0-9\]'/);
    assert.match(b, /length\(last_seen_at\)\s*=\s*19/);
    assert.doesNotMatch(b, /LIKE '% %'/);
    assert.match(b, /strftime\('%Y-%m-%dT%H:%M:%fZ', last_seen_at\)/);
    // Round-trip equality guard: only a real calendar datetime survives
    // normalization; invalid days/months/hours are left untouched.
    assert.match(b, /strftime\('%Y-%m-%d %H:%M:%S', last_seen_at\)\s*=\s*last_seen_at/);
    // Never reaches back into historical updated_at/created_at, seed uses strftime not CURRENT_TIMESTAMP
    assert.doesNotMatch(b, /updated_at|created_at/);
    assert.doesNotMatch(b, /SET last_seen_at = CURRENT_TIMESTAMP/);
  });
});

describe("createWidget clampInt behavior", () => {
  // clampInt is private; exercise it through the public createWidget handler
  // (POST /api/widgets → createWidget) without expanding the API surface.
  function makeFakeDb(): { db: D1Database; getStored: () => WidgetRow | undefined } {
    let stored: WidgetRow | undefined;
    let bound: unknown[] = [];
    let sql = "";
    const db = {
      prepare: (stmt: string) => {
        sql = stmt;
        return {
          bind: (...args: unknown[]) => {
            bound = args;
            return {
              run: async () => {
                // Only the INSERT builds the stored row; other statements (e.g.
                // the refresh path's sync-lock UPDATE, which runs synchronously
                // even with a no-op waitUntil) must not clobber it.
                if (sql.includes("INSERT INTO widgets")) {
                  // INSERT bind order — see src/lib/db.ts insertWidget.
                  stored = {
                    id: bound[0] as string,
                    public_id: bound[1] as string,
                    admin_token_hash: bound[2] as string,
                    name: bound[3] as string | null,
                    query: bound[4] as string,
                    period: bound[5] as WidgetRow["period"],
                    num_results: bound[6] as number,
                    widget_limit: bound[7] as number,
                    theme: bound[8] as WidgetRow["theme"],
                    status: bound[9] as WidgetRow["status"],
                    borderless: bound[10] as number,
                    show_summaries: bound[11] as number,
                    last_seen_at: (bound[12] as string | null) ?? null,
                    created_at: bound[13] as string,
                    updated_at: bound[14] as string,
                    last_run_id: null,
                    last_synced_at: null,
                    sync_locked_at: null,
                  };
                }
                return { meta: { success: true } };
              },
              first: async () => stored ?? null,
            };
          },
        };
      },
    };
    return { db: db as unknown as D1Database, getStored: () => stored };
  }


  async function createWith(body: Record<string, unknown>): Promise<{
    num_results: number;
    widget_limit: number;
  }> {
    const { db, getStored } = makeFakeDb();
    const env = {
      EXA_API_KEY: "test-key",
      DB: db,
      FEEDS: { put: async () => ({}) },
    } as unknown as Env;
    const req = new Request("https://test/api/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await handleWidgets(req, env, {
      waitUntil: () => {},
    } as unknown as ExecutionContext);
    assert.equal(res.status, 201, `expected 201 for ${JSON.stringify(body)}`);
    const stored = getStored();
    assert.ok(stored, "row was inserted");
    return { num_results: stored.num_results, widget_limit: stored.widget_limit };
  }

  it("falls back for null, false, empty, whitespace, and objects", async () => {
    for (const bad of [null, false, "", "   ", {}, []]) {
      const w = await createWith({ query: "climate", numResults: bad });
      assert.equal(w.num_results, 10, `numResults ${JSON.stringify(bad)} → fallback 10`);
      const v = await createWith({ query: "climate", widgetLimit: bad });
      assert.equal(v.widget_limit, 5, `widgetLimit ${JSON.stringify(bad)} → fallback 5`);
    }
    // undefined (field omitted) also falls back
    const w = await createWith({ query: "climate" });
    assert.equal(w.num_results, 10);
  });

  it("accepts non-empty finite numeric strings", async () => {
    assert.equal((await createWith({ query: "climate", numResults: "5" })).num_results, 5);
    assert.equal((await createWith({ query: "climate", numResults: " 7 " })).num_results, 7);
    assert.equal((await createWith({ query: "climate", numResults: "12" })).num_results, 12);
  });

  it("rounds and clamps finite numeric values", async () => {
    assert.equal((await createWith({ query: "climate", numResults: 2.6 })).num_results, 3);
    assert.equal((await createWith({ query: "climate", numResults: 99 })).num_results, 20);
    assert.equal((await createWith({ query: "climate", numResults: -5 })).num_results, 1);
    assert.equal((await createWith({ query: "climate", numResults: 7 })).num_results, 7);
    assert.equal((await createWith({ query: "climate", widgetLimit: 99 })).widget_limit, 50);
    assert.equal((await createWith({ query: "climate", widgetLimit: -1 })).widget_limit, 1);
  });
});

describe("widgets auth & error boundary", () => {
  // Minimal D1 stand-in: `first()` returns a fixed row (or throws), enough for
  // the single-widget route path (getWidgetById / getWidgetByPublicId).
  function fakeDb(first: () => Promise<WidgetRow | null>): D1Database {
    return {
      prepare: () => ({
        bind: () => ({
          first,
          run: async () => ({ meta: { success: true, changes: 0 } }),
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;
  }

  async function getWidget(path: string, env: Env): Promise<Response> {
    return handleWidgets(
      new Request(`https://test${path}`, {
        headers: { authorization: "Bearer client-token" },
      }),
      env,
      {} as unknown as ExecutionContext,
    );
  }

  it("missing/null stored hash cannot authenticate a client token", async () => {
    // A row whose admin_token_hash is null (anomalous legacy data).
    const legacyEnv = {
      EXA_API_KEY: "k",
      DB: fakeDb(() =>
        Promise.resolve(sampleRow({ admin_token_hash: null as unknown as string })),
      ),
      FEEDS: { put: async () => ({}) },
    } as unknown as Env;
    const res = await getWidget("/api/widgets/pub1", legacyEnv);
    assert.equal(res.status, 401);
  });

  it("exported wrapper turns a D1 rejection into a structured 503", async () => {
    const env = {
      EXA_API_KEY: "k",
      DB: fakeDb(() => Promise.reject(new Error("boom"))),
      FEEDS: { put: async () => ({}) },
    } as unknown as Env;
    const res = await getWidget("/api/widgets/pub1", env);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, "Database or service temporarily unavailable");
  });

  it("internal refresh/patch compensation catches remain in the handler", () => {
    const src = read("src/handlers/widgets.ts");
    // Manual refresh Exa/search error mapping is preserved
    assert.match(src, /searchError\(e, "refresh failed"\)/);
    // PATCH feed-failure compensation (502 / 500 inconsistent) is preserved
    assert.match(src, /Failed to update feed.*502/s);
    assert.match(src, /inconsistent state.*500/s);
  });

  it("createWidget insert catch logs and returns a fixed 500 without e.message", () => {
    const src = read("src/handlers/widgets.ts");
    // Structured context is logged server-side, never returned to the client
    assert.match(src, /console\.error\("widget insert failed", \{\s*widgetId: id,\s*publicId,/s);
    assert.match(src, /error: e/);
    // Fixed, non-sensitive message — no interpolation of the raw exception
    assert.match(src, /return error\("Failed to persist widget", 500\)/);
    assert.doesNotMatch(src, /Failed to persist widget:.*\$\{/);
  });

  it("deleteWidget deletes the D1 row before purging artifacts", () => {
    const src = read("src/handlers/widgets.ts");
    // D1 is the source of truth: delete row first, then best-effort purge
    assert.match(src, /deleteWidget\b[\s\S]*await db\.deleteWidgetRow/);
    assert.match(src, /deleteWidgetRow\(env\.DB, row\.id\)[\s\S]*purgeWidgetArtifacts/);
    // Purge is best-effort: failure is logged but still returns success
    assert.match(src, /purgeWidgetArtifacts\(env, row\.public_id\)[\s\S]*catch \(e\)/);
    assert.match(src, /purgeWidgetArtifacts\(env, row\.public_id\)[\s\S]*console\.error/);
    assert.match(src, /json\(\{ ok: true, deleted: row\.id, publicId: row\.public_id \}\)/);
  });

  it("deleteWidget returns success when artifact purge fails after D1 delete", async () => {
    // Behavioral: D1 delete succeeds, artifact purge throws → still 200.
    let purged = 0;
    const failPurgeBucket = {
      delete: async () => {
        purged++;
        throw new Error("purge boom");
      },
    };
    // purgeFeedCache uses caches.default + fetch internally but swallows errors;
    // deleteFeed/deleteNovelty call bucket.delete which throws here.
    const env = {
      EXA_API_KEY: "k",
      ROOT_TOKEN: "root-secret",
      DB: fakeDb(() => Promise.resolve(sampleRow())),
      FEEDS: failPurgeBucket,
    } as unknown as Env;
    const res = await handleWidgets(
      new Request("https://test/api/widgets/pub1", {
        method: "DELETE",
        headers: { authorization: "Bearer root-secret" },
      }),
      env,
      {} as unknown as ExecutionContext,
    );
    assert.equal(res.status, 200);
    assert.ok(purged > 0, "artifact purge was attempted after D1 delete");
    const body = (await res.json()) as { ok: boolean; deleted: string };
    assert.equal(body.ok, true);
    assert.equal(body.deleted, "id1");
  });

  it("deleteWidget does not purge artifacts when D1 delete fails", async () => {
    // Behavioral: D1 delete throws → no purge attempted, wrapper returns 503.
    let purged = 0;
    const bucket = {
      delete: async () => {
        purged++;
        return {};
      },
    };
    const failingDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => sampleRow(),
          run: async () => {
            throw new Error("d1 delete boom");
          },
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;
    const env = {
      EXA_API_KEY: "k",
      ROOT_TOKEN: "root-secret",
      DB: failingDb,
      FEEDS: bucket,
    } as unknown as Env;
    const res = await handleWidgets(
      new Request("https://test/api/widgets/pub1", {
        method: "DELETE",
        headers: { authorization: "Bearer root-secret" },
      }),
      env,
      {} as unknown as ExecutionContext,
    );
    assert.equal(res.status, 503);
    assert.equal(purged, 0, "no artifact purge when the D1 delete failed");
  });
});

describe("updateWidgetRow key allow-list", () => {
  it("throws on unknown interpolated keys", () => {
    const src = read("src/lib/db.ts");
    assert.match(src, /UPDATE_WIDGET_ALLOWED/);
    assert.match(src, /throw new Error\(`updateWidgetRow: unknown key/);
  });
});

describe("sync lock token ownership", () => {
  it("acquire returns opaque token or null; release matches token", () => {
    const src = read("src/lib/db.ts");
    // Returns an opaque ISO token string (or null), not a boolean
    assert.match(src, /tryAcquireSyncLock\([^)]*\): Promise<string \| null>/);
    assert.match(src, /releaseSyncLock[^)]*token: string/);
    // Release only clears when sync_locked_at exactly matches the token
    assert.match(src, /sync_locked_at = NULL WHERE id = \? AND sync_locked_at = \?/);
  });

  it("refresh passes its token through to release inside finally", () => {
    const src = read("src/lib/refresh.ts");
    const db = read("src/lib/db.ts");
    assert.match(src, /tryAcquireSyncLock\(env\.DB, widget\.id\)/);
    assert.match(src, /releaseSyncLock\(env\.DB, widget\.id, token\)/);
    assert.match(db, /tryAcquireSyncLock\([^)]*\): Promise<string \| null>/);
  });

  it("acquire only sets sync_locked_at and never touches updated_at", () => {
    const src = read("src/lib/db.ts");
    // Lock is bookkeeping, not a user-visible update: it must not bump updated_at
    assert.match(src, /UPDATE widgets SET sync_locked_at = \?/);
    assert.doesNotMatch(src, /SET sync_locked_at = \?, updated_at = \?/);
    // Stale-threshold semantics unchanged (same token + threshold bind)
    assert.match(src, /bind\(token, id, threshold\)/);
  });
});

describe("hitToItem rejects unsafe URLs", () => {
  it("drops non-http(s) schemes via canonicalizeUrl only", async () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      "vbscript:msgbox(1)",
      "   ",
    ]) {
      const item = await hitToItem(
        { url, title: "x", text: "body" } as SearchHit,
        "2026-01-01T00:00:00.000Z",
      );
      assert.equal(item, null, `expected null for ${JSON.stringify(url)}`);
    }
  });

  it("keeps http/https URLs canonical (no raw fallback)", async () => {
    const item = await hitToItem(
      { url: "http://www.Example.com/a/?utm_source=x", title: "t" } as SearchHit,
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(item?.url, "https://example.com/a");
    assert.ok(item?.id);
  });

  it("treats an explicit summary override as already finalized", async () => {
    const src = read("src/lib/feed.ts");
    // Override is assigned directly (null stays null), not re-finalized
    assert.match(src, /summaryOverride !== undefined\s*\?\s*summaryOverride/);
    assert.doesNotMatch(src, /finalizeSummary\(summaryOverride/);
    // Only the source fallback path calls finalizeSummary
    assert.match(src, /finalizeSummary\(\s*r\.summary \?\?/);
    // Override may carry an explicit null (no new summary) without ambiguity
    const item = await hitToItem(
      { url: "https://example.com/a", title: "t", summary: "raw body" } as SearchHit,
      "2026-01-01T00:00:00.000Z",
      null,
    );
    assert.equal(item?.summary, null);
    assert.ok(item);
  });
});

describe("mergeHitsIntoFeed tolerates malformed snapshots", () => {
  const widget = sampleRow({ public_id: "pub1", query: "climate news", widget_limit: 5 });

  function mockBucket(snapshotJson: unknown): { bucket: R2Bucket; bodyRef: { s: string } } {
    const bodyRef = { s: "" };
    const bucket = {
      get: async (key: string) =>
        key === `f/${widget.public_id}.json`
          ? ({ json: async () => snapshotJson } as R2ObjectBody)
          : null,
      put: async (key: string, value: BodyInit) => {
        bodyRef.s = typeof value === "string" ? value : "";
        return {} as R2Object;
      },
      delete: async () => ({} as R2Object),
    };
    return { bucket: bucket as unknown as R2Bucket, bodyRef };
  }

  it("items missing / null / non-array does not throw and yields an empty list", async () => {
    for (const items of [undefined, null, "oops", 42, { x: 1 }]) {
      const { bucket, bodyRef } = mockBucket({
        publicId: widget.public_id,
        query: widget.query,
        items,
      });
      const env = { FEEDS: bucket, FEED_CAP: "100" } as Env;
      const snap = await mergeHitsIntoFeedLocked(env, widget, [], undefined, "test-token");
      assert.ok(Array.isArray(snap.items), `items should be an array for ${JSON.stringify(items)}`);
      assert.equal(snap.items.length, 0, `empty for ${JSON.stringify(items)}`);
      assert.ok(bodyRef.s, "rewrote normalized snapshot back to R2");
    }
  });

  it("preserves prior summary on explicit null and honors a string override", async () => {
    const url = "https://example.com/a";
    const snap = (summary: string | null) => ({
      publicId: widget.public_id,
      query: widget.query,
      items: [
        {
          id: "x",
          title: "Old Title",
          url,
          publishedDate: null,
          summary,
          highlights: [],
          source: "example.com",
          seenAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const hit = { url, title: "New Title", text: "body" } as SearchHit;

    // Explicit null → hitToItem emits null, merge preserves the prior summary
    for (const existingSummary of ["prior summary", null]) {
      const { bucket, bodyRef } = mockBucket(snap(existingSummary));
      const env = { FEEDS: bucket, FEED_CAP: "100" } as Env;
      const out = await mergeHitsIntoFeedLocked(env, widget, [hit], new Map([[url, null]]), "test-token");
      const kept = out.items.find((i) => i.url === url);
      // explicit null never replaces the stored summary
      assert.equal(kept?.summary, existingSummary);
      assert.ok(JSON.parse(bodyRef.s), "wrote merged snapshot back");
    }

    // String override wins, even over a prior summary
    const { bucket, bodyRef } = mockBucket(snap("prior summary"));
    const env = { FEEDS: bucket, FEED_CAP: "100" } as Env;
    const out = await mergeHitsIntoFeedLocked(env, widget, [hit], new Map([[url, "new summary"]]), "test-token");
    assert.equal(out.items.find((i) => i.url === url)?.summary, "new summary");
    assert.ok(JSON.parse(bodyRef.s));
  });

  it("resolves explicit override only from a present map entry (no nested ternary)", () => {
    const src = read("src/lib/feed.ts");
    assert.match(src, /summariesByUrl\?\.has\(canon\)/);
    assert.match(src, /summariesByUrl\?\.has\(r\.url\)/);
    // prior summary flows through the merge, not re-finalized via hitToItem
    assert.match(src, /summary:\s*item\.summary \?\? prev\.summary/);
  });
});

describe("merge & purge contracts", () => {
  it("merge primitive is private; locked wrapper requires a token; refresh uses it", () => {
    const src = read("src/lib/feed.ts");
    // Unsafe read-merge-write primitive is module-private (no export)
    assert.doesNotMatch(src, /export (async )?function mergeHitsIntoFeed\b/);
    // Production API is a wrapper that requires an opaque sync-lock ownership token
    assert.match(src, /export async function mergeHitsIntoFeedLocked\b[\s\S]*_lockToken: string/);
    const ref = read("src/lib/refresh.ts");
    assert.match(ref, /mergeHitsIntoFeedLocked\(env, widget, kept, summaries, token\)/);
  });

  it("converts hits in parallel, then merges sequentially in input order", () => {
    const src = read("src/lib/feed.ts");
    // Independent hitToItem conversions are batched via Promise.all; merge/dup
    // handling runs afterward so original order + duplicate semantics hold.
    assert.match(src, /const converted = await Promise\.all\(\s*results\.map\(/);
  });

  it("purgeFeedCache derives origins only from env and dedupes", async () => {
    const deleted: string[] = [];
    const prev = (globalThis as Record<string, unknown>).caches;
    (globalThis as Record<string, unknown>).caches = {
      default: {
        delete: async (req: Request) => {
          deleted.push(req.url);
          return true;
        },
        match: async () => undefined,
        put: async () => {},
      },
    };
    try {
      await purgeFeedCache(
        {
          FEED_BASE_URL: "https://feed.example.com",
          PUBLIC_BASE_URL: "https://feed.example.com",
        } as never,
        "pid",
      );
    } finally {
      if (prev === undefined) delete (globalThis as Record<string, unknown>).caches;
      else (globalThis as Record<string, unknown>).caches = prev;
    }
    // Same origin via both env vars is deduplicated to one cache entry.
    assert.deepEqual(deleted, ["https://feed.example.com/f/pid.json"]);
    const src = read("src/lib/feed.ts");
    const purgeFn = src.slice(src.indexOf("export async function purgeFeedCache"));
    assert.doesNotMatch(purgeFn, /widget\.news/);
  });

  it("exports named tuning constants with expected defaults", () => {
    assert.equal(DEFAULT_FEED_CAP, 100);
    assert.equal(OVERFETCH_MULTIPLIER, 2);
    assert.equal(OVERFETCH_MIN_HEADROOM, 5);
    assert.equal(MAX_EXA_RESULTS, 100);
    assert.equal(DEFAULT_CRON_WIDGET_LIMIT, 40);
    assert.equal(DEFAULT_CRON_CONCURRENCY, 4);
  });

  it("sorts merged feed items deterministically by timestamp descending", async () => {
    const bucketData = { s: "" };
    const bucket = {
      get: async () => null,
      put: async (_k: string, v: unknown) => {
        bucketData.s = String(v);
        return {} as R2Object;
      },
    } as unknown as R2Bucket;
    const widget = sampleRow({ public_id: "sort-test" });
    const hits: SearchHit[] = [
      { url: "https://example.com/older", title: "Older", publishedDate: "2026-01-01T00:00:00.000Z" } as SearchHit,
      { url: "https://example.com/newer", title: "Newer", publishedDate: "2026-01-02T12:00:00+02:00" } as SearchHit,
      { url: "https://example.com/middle", title: "Middle", publishedDate: "2026-01-02T05:00:00.000Z" } as SearchHit,
    ];
    const snap = await mergeHitsIntoFeedLocked({ FEEDS: bucket, FEED_CAP: "100" } as never, widget, hits, undefined, "tok");
    assert.equal(snap.items[0].url, "https://example.com/newer");
    assert.equal(snap.items[1].url, "https://example.com/middle");
    assert.equal(snap.items[2].url, "https://example.com/older");
  });

  it("filterNovelResults evaluates entire candidate list for duplicates while keeping up to limit", () => {
    const hits: SearchHit[] = [
      { url: "https://example.com/1", title: "A" } as SearchHit,
      { url: "https://example.com/2", title: "B" } as SearchHit,
      { url: "https://example.com/1", title: "A duplicate" } as SearchHit,
    ];
    const { kept, dropped } = filterNovelResults(hits, { publicId: "p", runs: [] }, [], { limit: 1 });
    assert.equal(kept.length, 1);
    assert.equal(kept[0].url, "https://example.com/1");
    assert.equal(dropped, 2);
  });
});

describe("markInactiveWidgets skips sync-locked widgets", () => {
  it("filters out rows holding a non-NULL sync lock", () => {
    const src = read("src/lib/db.ts");
    assert.match(src, /sync_locked_at IS NULL OR sync_locked_at < \?/);
    // Stale-lock recovery stays in refresh acquisition; the unused helper is gone
    assert.doesNotMatch(src, /isLockHeld/);
  });
});

describe("worker routing contracts", () => {
  it("index routes presence and version 0.6", () => {
    const src = read("src/index.ts");
    assert.match(src, /handlePresence/);
    assert.match(src, /seenMatch/);
    assert.match(src, /api\\\/v|api\/v/);
    assert.match(src, /VERSION = "0\.6\.0"/);
    assert.match(src, /return error\("Internal error", 500\)/);
    assert.doesNotMatch(src, /e instanceof Error \? e\.message/);
    assert.doesNotMatch(src, /hasExaKey/);
  });

  it("presence handler throttles and reactivates", () => {
    const src = read("src/handlers/presence.ts");
    assert.match(src, /__seen\//);
    assert.match(src, /SEEN_TOUCH_MS/);
    assert.match(src, /touchWidgetSeen/);
    assert.match(src, /reactivated/);
    assert.match(src, /refreshWidget/);
    assert.match(src, /status:\s*204/);
  });

  it("widgets handler: ROOT_TOKEN, list scope, accessToken reuse, title", () => {
    const src = read("src/handlers/widgets.ts");
    assert.match(src, /ROOT_TOKEN/);
    assert.match(src, /isRootToken/);
    assert.match(src, /scope = "root"/);
    assert.match(src, /"client"/);
    assert.match(src, /accessToken/);
    assert.match(src, /listWidgetsByTokenHash/);
    assert.match(src, /listAllWidgets/);
    assert.doesNotMatch(src, /No widgets for this access key/);
    assert.match(src, /allowCreate/);
    assert.match(src, /function resolveTitle/);
    assert.match(src, /borderless/);
    assert.match(src, /showSummaries|show_summaries/);
    assert.match(src, /inactive/);
    // Create seeds last_seen; patch appearance purges edge cache
    assert.match(src, /last_seen_at:\s*now/);
    assert.match(src, /purgeFeedCache/);
  });

  it("auth is Bearer-only: no query token read or advertised", () => {
    const src = read("src/handlers/widgets.ts");
    // parseAuthToken must not fall back to a query `?token=` parameter
    assert.doesNotMatch(src, /searchParams\.get\("token"\)/);
    assert.match(src, /startsWith\("bearer "\)/);
    // Reject empty/whitespace bearer
    assert.match(src, /token \? token : null/);
    // 401 messages must not advertise a query-string login
    assert.doesNotMatch(src, /\?token=/);
    // adminUrl deep link embeds the key in a fragment, never a query
    const u = read("src/lib/urls.ts");
    assert.match(u, /\/admin\/#token=/);
    assert.doesNotMatch(u, /\/admin\/\?token=/);
  });

  it("db has touch and mark inactive", () => {
    const src = read("src/lib/db.ts");
    assert.match(src, /touchWidgetSeen/);
    assert.match(src, /markInactiveWidgets/);
    assert.match(src, /listWidgetsByTokenHash/);
    assert.match(src, /listAllWidgets/);
    assert.match(src, /last_seen_at \?\? null/);
  });

  it("refresh cron marks idle inactive first; delete purges feed cache", () => {
    const src = read("src/lib/refresh.ts");
    assert.match(src, /markIdleWidgetsInactive/);
    assert.match(src, /markInactiveWidgets/);
    assert.match(src, /listActiveWidgets/);
    assert.match(src, /purgeWidgetArtifacts/);
    assert.match(src, /purgeFeedCache\(env, publicId\)/);
  });

  it("manual refresh persists presence (active and inactive) only on success", () => {
    const src = read("src/handlers/widgets.ts");
    // Runs against an in-memory active snapshot, not a persisted status flip
    assert.match(src, /status: "active" as const/);
    // Any successful run is explicit owner activity: persist fresh last_seen,
    // reactivate to active only when the widget was inactive
    assert.match(src, /if \(result\.refreshed\)/);
    assert.match(src, /last_seen_at: new Date\(\)\.toISOString\(\)/);
    assert.match(src, /row\.status === "inactive"[\s\S]*persisted\.status = "active"/);
    // Failed refresh never touches the row (persist guarded by result.refreshed)
    assert.match(src, /result\.refreshed[\s\S]*updateWidgetRow/);
    // Response shape is unchanged
    assert.match(src, /refreshPayload\(result\)/);
  });

  it("manual refresh stays a success when presence persistence fails", () => {
    const src = read("src/handlers/widgets.ts");
    // Presence persist is best-effort inside its own try/catch after success
    assert.match(src, /if \(result\.refreshed\)[\s\S]*try \{/);
    assert.match(src, /updateWidgetRow\(env\.DB, row\.id, persisted\)/);
    // Structured failure log, but the successful payload is still returned
    assert.match(src, /console\.error\("refresh presence persist failed"/);
    assert.match(src, /refreshPayload\(result\)/);
  });

  it("createWidget rolls back D1 row and 502s when initial feed seed fails", () => {
    const src = read("src/handlers/widgets.ts");
    // Guard the refetched row instead of a non-null assertion
    assert.match(src, /const row = await db\.getWidgetById\(env\.DB, id\);/);
    assert.match(src, /return error\("Widget created but could not be loaded", 500\)/);
    // Seed wrapped in try so a failure rolls the just-inserted D1 row back
    assert.match(src, /await writeFeed\(env\.FEEDS, emptyFeed\(row\)\);/);
    assert.match(src, /await db\.deleteWidgetRow\(env\.DB, id\);/);
    // Cleanup failure is logged but the fixed 502 feed failure is kept
    assert.match(src, /catch \(cleanupErr\)/);
    assert.match(src, /console\.error\("feed seed rollback failed"/);
    // Original seed error and any rollback failure both logged server-side
    assert.match(src, /seedError: e/);
    assert.match(src, /rollbackError: cleanupErr/);
    // Fixed, non-sensitive response — never interpolates the raw exception
    assert.match(src, /return error\("Failed to initialize widget feed", 502\)/);
    assert.doesNotMatch(src, /Failed to initialize widget feed:.*\$\{/);
    // First fill background refresh only after the seed succeeds (waitUntil later)
    assert.match(src, /deleteWidgetRow\(env\.DB, id\)[\s\S]*ctx\.waitUntil/);
  });

  it("query change resets novelty+feed and always purges cache", () => {
    const src = read("src/handlers/widgets.ts");
    // Old-topic history must not block the new topic
    assert.match(src, /deleteNovelty\(env\.FEEDS, updated\.public_id\)/);
    // Old-topic items replaced immediately with an empty feed
    assert.match(src, /writeFeed\(env\.FEEDS, emptyFeed\(updated\)\)/);
    // Purge runs after any rewrite and when no snapshot exists (cached 404)
    assert.match(src, /await purgeFeedCache\(env, updated\.public_id\)/);
    assert.match(src, /dbFields\.last_synced_at = null/);
    assert.match(src, /query too long/);
    assert.match(src, /query-change refresh failed/);
  });

  it("patchWidget guards the row and compensates D1 on feed failure", () => {
    const src = read("src/handlers/widgets.ts");
    // Missing updated row is guarded (no non-null assertion) → controlled 404
    assert.match(src, /const updated = await db\.getWidgetById\(env\.DB, row\.id\);/);
    assert.doesNotMatch(src, /const updated = \(await db\.getWidgetById\(env\.DB, row\.id\)\)!/);
    assert.match(src, /if \(!updated\)[\s\S]*return error\("Widget not found", 404\)/);
    // D1 compensation restores every potentially mutated field from the prior row
    for (const f of [
      "name",
      "query",
      "period",
      "num_results",
      "widget_limit",
      "theme",
      "status",
      "borderless",
      "show_summaries",
      "last_seen_at",
      "last_synced_at",
      "updated_at",
    ]) {
      assert.match(src, new RegExp(`${f}: row\\.${f}`));
    }
    // Feed failure → 502 when rollback succeeds, 500 inconsistent when it fails
    assert.match(src, /Failed to update feed.*502/s);
    assert.match(src, /inconsistent state.*500/s);
    // Essential feed write happens before best-effort novelty / cache cleanup
    assert.match(src, /writeFeed\(env\.FEEDS, emptyFeed\(updated\)\)[\s\S]*deleteNovelty[\s\S]*purgeFeedCache/);
  });

  it("Env declares ROOT_TOKEN", () => {
    const src = read("worker-configuration.d.ts");
    assert.match(src, /ROOT_TOKEN\?/);
    assert.doesNotMatch(src, /SITE_ADMIN_TOKEN/);
  });
});

describe("client auth (localStorage permanent session)", () => {
  it("auth.js exposes permanent key API", () => {
    const src = read("public/auth.js");
    assert.match(src, /wn_access_token/);
    assert.match(src, /localStorage\.setItem/);
    assert.match(src, /localStorage\.removeItem/);
    assert.match(src, /getAccessToken/);
    assert.match(src, /setAccessToken/);
    assert.match(src, /clearAccessToken/);
    assert.match(src, /WN_AUTH/);
  });

  it("builder redirects logged-in users to admin unless ?new=1", () => {
    const src = read("public/app.js");
    assert.match(src, /forceNew/);
    assert.match(src, /getAccessToken|getStoredToken/);
    assert.match(src, /localeHref\("\/admin"\)/);
    assert.match(src, /accessToken/);
    assert.match(src, /reusedKey/);
    assert.match(src, /clearAccessToken|clearToken/);
  });

  it("admin auto-login and logout clear storage", () => {
    const src = read("public/admin/admin.js");
    assert.match(src, /getStoredToken|getAccessToken/);
    assert.match(src, /saveToken|setAccessToken/);
    assert.match(src, /doLogout|clearToken|clearAccessToken/);
    assert.match(src, /btn-logout/);
    assert.match(src, /btn-new-widget|new=1/);
  });

  it("HTML loads auth.js and new-widget / logout controls", () => {
    const index = read("public/index.html");
    assert.match(index, /auth\.js/);
    assert.match(index, /signed-in-banner|btn-logout-home/);
    assert.match(index, /id="title"/);

    const admin = read("public/admin/index.html");
    assert.match(admin, /auth\.js/);
    assert.match(admin, /btn-new-widget/);
    assert.match(admin, /btn-logout/);
    assert.match(admin, /btn-logout-manage/);
    assert.match(admin, /edit-title|edit-borderless|edit-summaries/);
    assert.match(admin, /btn-reset-appearance/);
    // no public-id field in login
    assert.doesNotMatch(admin, /id="public-id"/);
  });
});

describe("embed title / brand placement", () => {
  it("no query fallback for title; foot when empty", () => {
    const src = read("public/embed.js");
    assert.match(src, /function resolveTitle/);
    // must not fall back to data.query for section title
    assert.doesNotMatch(src, /data\.query\s*&&\s*String\(data\.query\)/);
    assert.match(src, /sectionTitle/);
    assert.match(src, /class: "foot"/);
    assert.match(src, /pingSeen|\/api\/v\//);
    assert.match(src, /data-no-ping/);
    assert.match(src, /borderless/);
  });
});

describe("i18n coverage", () => {
  it("en/ru/uk have access key and inactive strings", () => {
    const i18n = read("public/i18n.js");
    for (const key of [
      "status_inactive",
      "label_title",
      "label_borderless",
      "btn_new_widget",
      "home_signed_in",
      "btn_logout",
      "token_linked_hint",
      "label_token_linked",
    ]) {
      assert.match(i18n, new RegExp(`${key}:`));
    }
    // three locales present
    assert.match(i18n, /en:\s*\{/);
    assert.match(i18n, /ru:\s*\{/);
    assert.match(i18n, /uk:\s*\{/);
  });
});

describe("package / docs", () => {
  it("package version 0.6 and migrate scripts", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string; scripts: Record<string, string> };
    assert.equal(pkg.version, "0.6.0");
    assert.ok(pkg.scripts["db:migrate:remote"]);
    assert.ok(pkg.scripts["db:migrate:local"]);
    assert.ok(pkg.scripts["db:backfill-seen:remote"]);
    assert.ok(pkg.scripts["db:backfill-seen:local"]);
  });

  it("README documents ROOT_TOKEN and localStorage session", () => {
    const md = read("README.md");
    assert.match(md, /ROOT_TOKEN/);
    assert.doesNotMatch(md, /SITE_ADMIN_TOKEN/);
    assert.match(md, /localStorage|access key|accessToken/i);
    assert.match(md, /inactive/i);
    assert.match(md, /\/api\/v\//);
    assert.match(md, /borderless/);
    assert.match(md, /showSummaries/);
  });

  it("dev.vars.example has ROOT_TOKEN", () => {
    const ex = read(".dev.vars.example");
    assert.match(ex, /ROOT_TOKEN/);
    assert.doesNotMatch(ex, /SITE_ADMIN_TOKEN/);
  });
});

describe("normalizeTheme still maps legacy", () => {
  it("auto → site", () => {
    assert.equal(normalizeTheme("auto"), "site");
  });
});
