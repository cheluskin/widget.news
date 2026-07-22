import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  cleanSummary,
  finalizeSummary,
  softTrim,
  stripTitleEcho,
  SUMMARY_MAX_CHARS,
} from "../src/lib/clean-summary.ts";
import { hashUrl, nanoid, sha256Hex, timingSafeEqual } from "../src/lib/ids.ts";
import {
  filterNovelResults,
  titleSimilarity,
  tokenizeTitle,
  appendNoveltyRun,
  type NoveltyState,
} from "../src/lib/novelty.ts";
import {
  isDue,
  isLockHeld,
  jitterMs,
  periodMs,
  shouldMarkInactive,
  startPublishedDate,
  INACTIVE_AFTER_MS,
  INACTIVE_GRACE_MS,
  JITTER_MAX_MS,
} from "../src/lib/schedule.ts";
import { toSearchHits } from "../src/lib/exa.ts";
import {
  needsHtmlTrailingSlash,
  parseLocalePath,
  withLocalePrefix,
} from "../src/lib/locale.ts";
import { embedSnippet, isLocalUrl } from "../src/lib/urls.ts";
import { canonicalizeUrl } from "../src/lib/urls-canon.ts";
import { emptyFeed, feedCacheControl, feedCdnCacheControl, feedCacheRequest } from "../src/lib/feed.ts";
import { isThemeInput, isUserStatus, normalizeTheme, type WidgetRow } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("feed cache headers", () => {
  it("empty feed is not edge-cached", () => {
    assert.match(feedCacheControl(0), /max-age=0/);
    assert.match(feedCdnCacheControl(0), /max-age=0/);
  });
  it("non-empty feed allows browser + edge TTL", () => {
    const cc = feedCacheControl(3);
    assert.match(cc, /max-age=60/);
    assert.match(cc, /s-maxage=300/);
    assert.match(feedCdnCacheControl(3), /max-age=300/);
  });
  it("cache key strips to stable feed URL", () => {
    const r = feedCacheRequest("https://widget.news/", "abc123");
    assert.equal(r.url, "https://widget.news/f/abc123.json");
    assert.equal(r.method, "GET");
  });
});

describe("cleanSummary", () => {
  it("strips Key takeaways prefix", () => {
    assert.equal(cleanSummary("Key takeaways: Foo bar."), "Foo bar.");
  });
  it("strips Russian labels", () => {
    assert.equal(cleanSummary("Ключевые моменты статьи: Тест."), "Тест.");
  });
  it("returns null for empty", () => {
    assert.equal(cleanSummary("  "), null);
  });
});

describe("summary 2-line finalize", () => {
  it("softTrim keeps short text", () => {
    assert.equal(softTrim("Short blurb.", 150), "Short blurb.");
  });

  it("softTrim prefers sentence end over hard mid-cut", () => {
    const long =
      "Regulators approved the merger after a year-long review. " +
      "Competitors said the deal still threatens local markets and may raise prices further next year for consumers.";
    const out = softTrim(long, 120);
    assert.ok(out.length <= 120);
    assert.match(out, /\.$|…$/);
    // Should not be a raw mid-word slice of the second sentence only
    assert.ok(out.includes("merger") || out.endsWith("…"));
  });

  it("stripTitleEcho drops headline restatement", () => {
    const title = "Acme raises $50M Series B for climate tech";
    const echoed = "Acme raises $50M Series B for climate tech to expand European operations next year.";
    const out = stripTitleEcho(echoed, title);
    assert.ok(out.length < echoed.length);
    assert.match(out.toLowerCase(), /expand|european|operations/);
    assert.doesNotMatch(out.toLowerCase(), /^acme raises/);
  });

  it("stripTitleEcho clears full duplicate", () => {
    assert.equal(stripTitleEcho("Same title here", "Same title here"), "");
  });

  it("finalizeSummary cleans, de-echoes, and fits ~2 lines", () => {
    const title = "City council bans e-scooters downtown";
    const raw =
      "Key takeaways: City council bans e-scooters downtown after a spike in injuries, with the rule taking effect next month and fines for operators.";
    const out = finalizeSummary(raw, title, SUMMARY_MAX_CHARS);
    assert.ok(out);
    assert.ok(out!.length <= SUMMARY_MAX_CHARS);
    assert.doesNotMatch(out!, /Key takeaways/i);
    // Should still convey useful angle beyond title words alone
    assert.match(out!.toLowerCase(), /injur|fine|month|operator|rule|effect/);
  });

  it("summarize prompt targets 2 lines and no title echo", () => {
    const src = readFileSync(join(root, "src/lib/summarize.ts"), "utf8");
    assert.match(src, /TWO short lines|two short lines|2 short lines|120–150|120-150/i);
    assert.match(src, /do NOT repeat|do not restate|Never restate/i);
    assert.match(src, /max_tokens:\s*80/);
    assert.match(src, /finalizeSummary/);
  });
});

describe("canonicalizeUrl", () => {
  it("strips www, utm, trailing slash, forces https", () => {
    const a = canonicalizeUrl("http://www.Example.com/path/?utm_source=x&id=1");
    const b = canonicalizeUrl("https://example.com/path?id=1");
    assert.equal(a, b);
    assert.equal(a, "https://example.com/path?id=1");
  });
  it("drops trailing slash", () => {
    assert.equal(canonicalizeUrl("https://ex.com/a/"), "https://ex.com/a");
  });
});

describe("schedule", () => {
  it("periodMs", () => {
    assert.equal(periodMs("1h"), 3600_000);
    assert.equal(periodMs("1d"), 864e5);
  });
  it("jitter is stable and within 30m", () => {
    const a = jitterMs("widget_abc");
    const b = jitterMs("widget_abc");
    assert.equal(a, b);
    assert.ok(a >= 0 && a <= JITTER_MAX_MS);
  });
  it("isDue when never synced", () => {
    assert.equal(isDue("1d", null, "id1"), true);
  });
  it("isDue respects period then jitter", () => {
    const id = "w1";
    const j = jitterMs(id);
    const last = Date.parse("2026-07-15T10:00:00.000Z");
    const dueAt = last + periodMs("1h");
    if (j > 0) {
      assert.equal(isDue("1h", "2026-07-15T10:00:00.000Z", id, dueAt + Math.floor(j / 2)), false);
    }
    assert.equal(isDue("1h", "2026-07-15T10:00:00.000Z", id, dueAt + j), true);
  });
  it("startPublishedDate uses last_synced − period buffer", () => {
    const last = "2026-07-15T12:00:00.000Z";
    const s = startPublishedDate("1d", last, Date.parse("2026-07-16T12:00:00.000Z"));
    assert.equal(s, new Date(Date.parse(last) - periodMs("1d")).toISOString());
  });
  it("startPublishedDate first run uses 2× period", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    const s = startPublishedDate("1d", null, now);
    assert.equal(s, new Date(now - 2 * periodMs("1d")).toISOString());
  });
  it("isLockHeld", () => {
    const now = Date.now();
    assert.equal(isLockHeld(null, now), false);
    assert.equal(isLockHeld(new Date(now - 60_000).toISOString(), now), true);
    assert.equal(isLockHeld(new Date(now - 10 * 60_000).toISOString(), now), false);
  });
});

describe("exa toSearchHits", () => {
  it("normalizes highlights and text", () => {
    const hits = toSearchHits([
      {
        url: "https://ex.com/a",
        title: " A ",
        highlights: "one",
        text: { text: " body " },
      },
      { url: "  ", title: "skip" },
      { url: "https://ex.com/b", highlights: ["h1", "h2"], text: "plain" },
    ]);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]!.title, "A");
    assert.deepEqual(hits[0]!.highlights, ["one"]);
    assert.equal(hits[0]!.text, "body");
    assert.deepEqual(hits[1]!.highlights, ["h1", "h2"]);
    assert.equal(hits[1]!.text, "plain");
  });
});

describe("novelty", () => {
  it("titleSimilarity high for near-dupes", () => {
    const a = tokenizeTitle("Acme AI raises $25M Series A funding round");
    const b = tokenizeTitle("Acme AI raises 25M Series A funding");
    assert.ok(titleSimilarity(a, b) >= 0.5);
  });
  it("filters URL seen in last runs (canonical)", () => {
    const state: NoveltyState = {
      publicId: "p1",
      runs: [
        {
          at: "2026-07-01T00:00:00.000Z",
          runId: "r1",
          items: [
            {
              url: "https://ex.com/a",
              title: "Old story",
              tokens: tokenizeTitle("Old story"),
            },
          ],
        },
      ],
    };
    const { kept, dropped } = filterNovelResults(
      [
        { url: "http://www.ex.com/a/?utm_source=x", title: "Old story again" },
        { url: "https://ex.com/b", title: "Brand new development today" },
      ],
      state,
      [],
      { limit: 10 },
    );
    assert.equal(dropped, 1);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.url, "https://ex.com/b");
  });
  it("filters title-similar against feed (not only runs)", () => {
    const state: NoveltyState = { publicId: "p1", runs: [] };
    const feed = [
      {
        url: "https://a.com/1",
        title: "OpenAI launches new GPT model for enterprise",
      },
    ];
    const { kept } = filterNovelResults(
      [
        {
          url: "https://b.com/2",
          title: "OpenAI launches new GPT model for enterprise customers",
        },
        { url: "https://c.com/3", title: "Chile copper exports hit record high in June" },
      ],
      state,
      feed,
    );
    assert.ok(kept.some((r) => r.url === "https://c.com/3"));
    assert.ok(!kept.some((r) => r.url?.includes("b.com")));
  });
  it("appendNoveltyRun keeps 5", () => {
    let s: NoveltyState = { publicId: "x", runs: [] };
    for (let i = 0; i < 7; i++) {
      s = appendNoveltyRun(s, `r${i}`, [{ url: `https://u/${i}`, title: `T ${i}` }]);
    }
    assert.equal(s.runs.length, 5);
    assert.equal(s.runs[0]!.runId, "r6");
  });
});

describe("ids", () => {
  it("nanoid length", () => {
    assert.equal(nanoid(12).length, 12);
  });
  it("sha256 hex", async () => {
    const h = await sha256Hex("abc");
    assert.equal(h.length, 64);
  });
  it("timingSafeEqual", () => {
    assert.equal(timingSafeEqual("aa", "aa"), true);
    assert.equal(timingSafeEqual("aa", "ab"), false);
  });
  it("hashUrl stable", async () => {
    const a = await hashUrl("https://example.com/x");
    const b = await hashUrl("https://example.com/x");
    assert.equal(a, b);
  });
});

describe("urls", () => {
  it("detects localhost", () => {
    assert.equal(isLocalUrl("http://localhost:8787"), true);
    assert.equal(isLocalUrl("https://widget.news"), false);
  });
});

describe("locale path", () => {
  it("parses ru prefix", () => {
    assert.deepEqual(parseLocalePath("/ru/admin"), { locale: "ru", assetPath: "/admin" });
    assert.deepEqual(parseLocalePath("/ru/admin/"), { locale: "ru", assetPath: "/admin/" });
    assert.deepEqual(parseLocalePath("/uk"), { locale: "uk", assetPath: "/" });
  });
  it("defaults en without prefix", () => {
    assert.deepEqual(parseLocalePath("/demo"), { locale: "en", assetPath: "/demo" });
  });
  it("needsHtmlTrailingSlash for app dirs only", () => {
    assert.equal(needsHtmlTrailingSlash("/admin"), true);
    assert.equal(needsHtmlTrailingSlash("/admin/"), false);
    assert.equal(needsHtmlTrailingSlash("/embed.js"), false);
    assert.equal(needsHtmlTrailingSlash("/"), false);
  });
  it("withLocalePrefix keeps /ru on trailing-slash redirect targets", () => {
    assert.equal(withLocalePrefix("ru", "/admin/"), "/ru/admin/");
    assert.equal(withLocalePrefix("en", "/admin/"), "/admin/");
    assert.equal(withLocalePrefix("uk", "/"), "/uk/");
  });
});

describe("theme", () => {
  it("normalizeTheme maps site/light/dark and legacy auto", () => {
    assert.equal(normalizeTheme("site"), "site");
    assert.equal(normalizeTheme("light"), "light");
    assert.equal(normalizeTheme("dark"), "dark");
    assert.equal(normalizeTheme("auto"), "site");
    assert.equal(normalizeTheme(undefined), "site");
    assert.equal(normalizeTheme(null), "site");
    assert.equal(normalizeTheme(""), "site");
    assert.equal(normalizeTheme("neon"), "site");
  });

  it("isThemeInput accepts site/light/dark/auto only", () => {
    assert.equal(isThemeInput("site"), true);
    assert.equal(isThemeInput("light"), true);
    assert.equal(isThemeInput("dark"), true);
    assert.equal(isThemeInput("auto"), true);
    assert.equal(isThemeInput("neon"), false);
    assert.equal(isThemeInput(""), false);
    assert.equal(isThemeInput(undefined), false);
    assert.equal(isThemeInput(1), false);
  });

  it("embedSnippet writes data-theme and data-limit", () => {
    const env = {
      PUBLIC_BASE_URL: "https://widget.news",
      FEED_BASE_URL: "https://cdn.widget.news",
    } as Env;
    const snip = embedSnippet(env, {
      publicId: "pub_abc",
      theme: "dark",
      widgetLimit: 7,
    });
    assert.match(snip, /data-wn="pub_abc"/);
    assert.match(snip, /data-theme="dark"/);
    assert.match(snip, /data-limit="7"/);
    assert.match(snip, /data-feed-base="https:\/\/cdn\.widget\.news"/);
    assert.match(snip, /src="https:\/\/widget\.news\/embed\.js"/);
  });

  it("embedSnippet includes title, borderless, summaries prefs", () => {
    const env = { PUBLIC_BASE_URL: "https://widget.news" } as Env;
    const snip = embedSnippet(env, {
      publicId: "x",
      theme: "site",
      widgetLimit: 5,
      title: 'Tech "News"',
      borderless: true,
      showSummaries: false,
    });
    assert.match(snip, /data-title="Tech &quot;News&quot;"/);
    assert.match(snip, /data-borderless="1"/);
    assert.match(snip, /data-summaries="0"/);
  });

  it("embedSnippet omits empty title and default prefs", () => {
    const env = { PUBLIC_BASE_URL: "https://widget.news" } as Env;
    const snip = embedSnippet(env, {
      publicId: "x",
      theme: "site",
      widgetLimit: 5,
      title: "  ",
      borderless: false,
      showSummaries: true,
    });
    assert.doesNotMatch(snip, /data-title=/);
    assert.doesNotMatch(snip, /data-borderless=/);
    assert.doesNotMatch(snip, /data-summaries=/);
  });

  it("embedSnippet defaults theme value as passed (site)", () => {
    const env = { PUBLIC_BASE_URL: "https://widget.news" } as Env;
    const snip = embedSnippet(env, {
      publicId: "x",
      theme: "site",
      widgetLimit: 5,
    });
    assert.match(snip, /data-theme="site"/);
    assert.doesNotMatch(snip, /data-feed-base=/);
  });

  it("isUserStatus rejects inactive", () => {
    assert.equal(isUserStatus("active"), true);
    assert.equal(isUserStatus("paused"), true);
    assert.equal(isUserStatus("inactive"), false);
  });

  it("shouldMarkInactive respects grace and last_seen", () => {
    const now = Date.parse("2026-07-18T12:00:00.000Z");
    // too new
    assert.equal(
      shouldMarkInactive(new Date(now - INACTIVE_GRACE_MS + 1000).toISOString(), null, now),
      false,
    );
    // past grace, never seen
    assert.equal(
      shouldMarkInactive(new Date(now - INACTIVE_GRACE_MS - 1000).toISOString(), null, now),
      true,
    );
    // recently seen
    assert.equal(
      shouldMarkInactive(
        new Date(now - INACTIVE_GRACE_MS - 1000).toISOString(),
        new Date(now - 1000).toISOString(),
        now,
      ),
      false,
    );
    // seen too long ago
    assert.equal(
      shouldMarkInactive(
        new Date(now - INACTIVE_GRACE_MS - 1000).toISOString(),
        new Date(now - INACTIVE_AFTER_MS - 1000).toISOString(),
        now,
      ),
      true,
    );
  });

  it("emptyFeed normalizes legacy auto theme to site", () => {
    const widget = {
      public_id: "p1",
      query: "AI news",
      theme: "auto" as unknown as WidgetRow["theme"],
      widget_limit: 5,
    } as WidgetRow;
    const feed = emptyFeed(widget);
    assert.equal(feed.theme, "site");
    assert.equal(feed.publicId, "p1");
    assert.equal(feed.query, "AI news");
    assert.equal(feed.widgetLimit, 5);
    assert.deepEqual(feed.items, []);
  });

  it("emptyFeed keeps light and dark", () => {
    for (const theme of ["light", "dark"] as const) {
      const feed = emptyFeed({
        public_id: "p",
        query: "q",
        theme,
        widget_limit: 3,
      } as WidgetRow);
      assert.equal(feed.theme, theme);
    }
  });

  it("embed.js supports site inherit + light/dark palettes", () => {
    const src = readFileSync(join(root, "public/embed.js"), "utf8");
    // Default theme
    assert.match(src, /return "site"/);
    assert.match(src, /data-theme"\) \|\| "site"/);
    // Site mode inherits host styles (no all:initial)
    assert.match(src, /mode === "site"/);
    assert.match(src, /inherit:\s*true/);
    assert.match(src, /:host\{display:block;color:inherit;font:inherit/);
    // Fixed skins isolate from host
    assert.match(src, /all:initial/);
    // Title optional + foot brand + presence beacon
    assert.match(src, /resolveTitle/);
    assert.match(src, /class: "foot"/);
    assert.match(src, /\/api\/v\//);
    assert.match(src, /data-borderless/);
    assert.match(src, /data-summaries/);
    assert.match(src, /#202124/);
    assert.match(src, /#ffffff/);
    // Legacy auto → site
    assert.match(src, /legacy "auto"/);
  });

  it("builder UI exposes site/light/dark (not auto as default)", () => {
    const index = readFileSync(join(root, "public/index.html"), "utf8");
    assert.match(index, /data-theme="site"/);
    assert.match(index, /name="theme" value="site"/);
    assert.match(index, /data-theme="light"/);
    assert.match(index, /data-theme="dark"/);
    assert.doesNotMatch(index, /data-theme="auto"/);

    const admin = readFileSync(join(root, "public/admin/index.html"), "utf8");
    assert.match(admin, /data-theme="site"/);
    assert.match(admin, /id="edit-theme" value="site"/);
    assert.doesNotMatch(admin, /data-theme="auto"/);

    const i18n = readFileSync(join(root, "public/i18n.js"), "utf8");
    assert.match(i18n, /theme_site:\s*"Site styles"/);
    assert.match(i18n, /theme_site:\s*"Стили сайта"/);
    assert.match(i18n, /theme_site:\s*"Стилі сайту"/);
  });
});
