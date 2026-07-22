/**
 * Coverage for v0.6: title/appearance, presence/inactive, auth (ROOT + client key),
 * permanent localStorage session, feed presentation, UI contracts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  emptyFeed,
  feedPresentationFromWidget,
  feedKey,
} from "../src/lib/feed.ts";
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
} from "../src/lib/urls.ts";
import { asBool, isUserStatus, normalizeTheme, type WidgetRow } from "../src/lib/types.ts";

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

  it("adminUrl embeds token for first-time deep link", () => {
    const u = adminUrl(env, "pub", "secret-token-xyz");
    assert.equal(u, "https://widget.news/admin/?token=secret-token-xyz");
  });

  it("feedUrl uses CDN base", () => {
    assert.equal(feedUrl(env, "pid"), "https://cdn.widget.news/f/pid.json");
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

  it("migrate.sql adds v0.6 columns", () => {
    const m = read("src/db/migrate.sql");
    assert.match(m, /borderless/);
    assert.match(m, /show_summaries/);
    assert.match(m, /last_seen_at/);
  });
});

describe("worker routing contracts", () => {
  it("index routes presence and version 0.6", () => {
    const src = read("src/index.ts");
    assert.match(src, /handlePresence/);
    assert.match(src, /seenMatch/);
    assert.match(src, /api\\\/v|api\/v/);
    assert.match(src, /VERSION = "0\.6\.0"/);
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
    assert.match(src, /function resolveTitle/);
    assert.match(src, /borderless/);
    assert.match(src, /showSummaries|show_summaries/);
    assert.match(src, /inactive/);
  });

  it("db has touch and mark inactive", () => {
    const src = read("src/lib/db.ts");
    assert.match(src, /touchWidgetSeen/);
    assert.match(src, /markInactiveWidgets/);
    assert.match(src, /listWidgetsByTokenHash/);
    assert.match(src, /listAllWidgets/);
  });

  it("refresh cron marks idle inactive first", () => {
    const src = read("src/lib/refresh.ts");
    assert.match(src, /markIdleWidgetsInactive/);
    assert.match(src, /markInactiveWidgets/);
    assert.match(src, /listActiveWidgets/);
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
