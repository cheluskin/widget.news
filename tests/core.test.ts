import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanSummary } from "../src/lib/clean-summary.ts";
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
  startPublishedDate,
  JITTER_MAX_MS,
} from "../src/lib/period.ts";
import { isLocalUrl } from "../src/lib/urls.ts";
import { canonicalizeUrl } from "../src/lib/urls-canon.ts";

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

describe("period / schedule", () => {
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
