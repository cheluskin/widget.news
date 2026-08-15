import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// Source-contract tests for the frontend auth transport (no DOM/jsdom needed):
// tokens flow via `#token=` fragment staging + Bearer headers, never the query.
// Scope split: root/unknown credentials stay session-only; only client keys
// persist in localStorage, with explicit finite expiry. The server-side
// fragment link helper is backend scope — not asserted here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(join(root, p), "utf8");
const authJs = read("public/auth.js");
const appJs = read("public/app.js");
const adminJs = read("public/admin/admin.js");

describe("no query-string tokens in owned frontend JS", () => {
  it("no ?token= anywhere", () => {
    for (const [name, src] of [
      ["auth.js", authJs],
      ["app.js", appJs],
      ["admin.js", adminJs],
    ] as const) {
      assert.ok(!src.includes("?token="), `${name} leaks ?token=`);
    }
  });
  it("app.js/admin.js never read token via URLSearchParams", () => {
    for (const [name, src] of [
      ["app.js", appJs],
      ["admin.js", adminJs],
    ] as const) {
      assert.ok(!/\.get\(\s*["']token["']\s*\)/.test(src), `${name} reads searchParams token`);
    }
    assert.ok(!adminJs.includes("location.search"), "admin.js still parses location.search");
    assert.ok(!adminJs.includes("URLSearchParams"), "admin.js keeps the legacy params helper");
  });
  it("auth.js uses location.search only inside the replaceState cleanup", () => {
    const rest = authJs.replace(/location\.pathname\s*\+\s*location\.search/g, "");
    assert.ok(!rest.includes("location.search"), "auth.js must not parse the query string");
  });
});

describe("auth.js synchronous fragment bootstrap", () => {
  it("parses location.hash (without #) before exporting the auth API", () => {
    const hashIdx = authJs.indexOf("location.hash");
    const exportIdx = authJs.indexOf("global.WN_AUTH");
    assert.ok(hashIdx > -1 && exportIdx > -1, "bootstrap or WN_AUTH export missing");
    assert.ok(hashIdx < exportIdx, "fragment bootstrap must precede the WN_AUTH export");
    assert.match(authJs, /URLSearchParams\(\s*(?:location\.hash|hash)\.slice\(1\)\s*\)/);
  });
  it("trims, validates, and stages the deep link in sessionStorage only", () => {
    const m = authJs.match(/\(function bootstrapFragmentToken\(\) \{[\s\S]*?\}\)\(\);/);
    assert.ok(m, "bootstrap missing");
    assert.match(m[0], /\.get\(\s*"token"\s*\)[^;]*\.trim\(\)/);
    assert.match(m[0], /stageToken\(token\)/);
    assert.ok(!m[0].includes("localStorage.setItem"), "unknown-scope deep link must not persist");
  });
  it("exposes no raw bootstrap token globally", () => {
    assert.deepEqual(authJs.match(/global\.\w+ =/g), ["global.WN_AUTH ="]);
  });
});

describe("auth.js fragment bootstrap scope handling", () => {
  it("honors an existing stored credential before staging the deep link", () => {
    const m = authJs.match(/\(function bootstrapFragmentToken\(\) \{[\s\S]*?\}\)\(\);/);
    assert.ok(m, "bootstrap missing");
    const body = m[0];
    const guardIdx = body.indexOf("if (token && !readPersistent() && !readStaged())");
    const stageIdx = body.indexOf("stageToken(token)");
    assert.ok(guardIdx > -1 && stageIdx > -1, "staging must be guarded by current-credential reads");
    assert.ok(guardIdx < stageIdx, "existing credential check must precede staging");
  });
  it("scrubs every token-bearing fragment, even an empty #token=", () => {
    const m = authJs.match(/\(function bootstrapFragmentToken\(\) \{[\s\S]*?\}\)\(\);/);
    assert.ok(m, "bootstrap missing");
    const body = m[0];
    assert.match(body, /hasToken = params\.has\("token"\)/);
    const stageIdx = body.indexOf("stageToken(token)");
    const guardIdx = body.indexOf("if (!hasToken) return;");
    const scrubIdx = body.indexOf('history.replaceState({}, "", location.pathname + location.search + remainingHash)');
    assert.ok(stageIdx > -1 && guardIdx > -1 && scrubIdx > -1, "staging or scrub missing");
    assert.ok(stageIdx < guardIdx && guardIdx < scrubIdx, "scrub follows staging, gated only on hasToken");
    assert.ok(!body.includes("if (!token) return;"), "an empty token must not skip the scrub");
  });
  it("removes only token parameters and preserves the rest of the fragment", () => {
    assert.match(authJs, /params\.delete\("token"\)/);
    const replaced: string[] = [];
    const window: { WN_AUTH?: unknown } = {};
    new Function("window", "localStorage", "sessionStorage", "location", "history", authJs)(
      window,
      { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      { hash: "#token=secret&view=stats&tab=recent", pathname: "/admin/", search: "?lang=ru" },
      { replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) },
    );
    assert.deepEqual(replaced, ["/admin/?lang=ru#view=stats&tab=recent"]);
  });
});

describe("app.js Bearer GETs + fragment admin links", () => {
  it("poll and saved-widget GETs send Authorization Bearer, no query token", () => {
    assert.ok(appJs.includes('authorization: "Bearer " + state.adminToken'), "poll GET missing Bearer");
    assert.ok(appJs.includes('authorization: "Bearer " + tok'), "saved-widget GET missing Bearer");
  });
  it("localizeAdminUrl: absolute serverUrl wins (query/hash stripped), fragment-only token", () => {
    assert.match(appJs, /function localizeAdminUrl\(serverUrl, token\) \{[\s\S]*?u\.search = "";[\s\S]*?u\.hash = "";[\s\S]*?location\.origin \+ localeHref\("\/admin"\)[\s\S]*?"#token=" \+ encodeURIComponent\(token\)/);
    const m = appJs.match(/function localizeAdminUrl\(serverUrl, token\) \{[\s\S]*?\n  \}/);
    const fn = new Function("location", "localeHref", m![0] + "; return localizeAdminUrl;")(
      { origin: "https://local.test" }, (p: string) => "/en" + p);
    assert.equal(fn("https://be.test/admin?token=x#y", "k"), "https://be.test/admin#token=k");
    assert.equal(fn("https://be.test/a?token=t", ""), "https://be.test/a", "query never re-emitted");
    assert.equal(fn("javascript:x?token=t", null), "https://local.test/en/admin", "invalid falls back");
    assert.equal(fn(null, "k"), "https://local.test/en/admin#token=k", "absent falls back");
  });
  it("restored session links drop publicId/tok and never re-expose the token", () => {
    assert.ok(!/localizeAdminUrl\([^)]*(publicId|,\s*tok\))/.test(appJs), "stale args dropped");
    assert.ok(appJs.includes("localizeAdminUrl(data.adminUrl, token)"), "serverUrl honored");
    assert.equal((appJs.match(/localizeAdminUrl\(null, null\)/g) || []).length, 2, "clean restores");
  });
  it("every #open-admin href assignment drops data-lang-path so i18n keeps the fragment", () => {
    const sets = appJs.match(/openAdmin\.href =/g) || [];
    const drops = appJs.match(/openAdmin\.removeAttribute\("data-lang-path"\)/g) || [];
    assert.ok(sets.length >= 3, "expected 3 #open-admin href assignments");
    assert.equal(drops.length, sets.length);
  });
  it("refresh POST encodes the widget id path segment like every other call", () => {
    assert.ok(
      appJs.includes('"/api/widgets/" + encodeURIComponent(state.id) + "/refresh"'),
      "refresh POST must encodeURIComponent(state.id)",
    );
    // No raw id/publicId interpolation remains in any app.js widgets API URL
    assert.ok(
      !/"\/api\/widgets\/" \+ (?!encodeURIComponent)/.test(appJs),
      "raw id interpolation left in an app.js widgets API URL",
    );
  });
});

describe("admin.js storage-only auth", () => {
  it("widget list GET uses a Bearer header without content-type", () => {
    const m = adminJs.match(/fetch\("\/api\/widgets", \{[\s\S]*?\},?\s*\}\s*\)/);
    assert.ok(m, "list fetch lost its headers");
    assert.match(m[0], /headers: \{ authorization: "Bearer " \+ token \}/);
    assert.ok(!/content-type/i.test(m[0]), "GET must not set content-type");
  });
  it("prefill + auto-login rely on the stored token only", () => {
    assert.ok((adminJs.match(/if \(getStoredToken\(\)\) \{/g) || []).length >= 2);
  });
});

describe("admin.js last-widget deletion drops the stored credential", () => {
  it("empty-widget branch calls clearToken() with state.token = null", () => {
    const del = adminJs.match(/btnDelete\.addEventListener\("click"[\s\S]*?\n    \}\);/);
    assert.ok(del, "delete handler missing");
    assert.match(
      del[0],
      /if \(state\.widgets\.length === 0\) \{[\s\S]*?clearToken\(\);\s*state\.token = null;/,
      "last widget deletion must permanently clear the stored token",
    );
  });
  it("multi-widget branch keeps the shared token", () => {
    const del = adminJs.match(/btnDelete\.addEventListener\("click"[\s\S]*?\n    \}\);/);
    assert.ok(del, "delete handler missing");
    const elseM = del[0].match(/\} else if \(listCard\) \{[\s\S]*?\n          \}/);
    assert.ok(elseM, "multi-widget branch missing");
    assert.ok(!elseM[0].includes("clearToken("), "shared token must survive while widgets remain");
  });
});

describe("admin.js refresh/delete click registrations are null-guarded", () => {
  it("each button registers exactly one listener, fully inside an existence guard", () => {
    for (const btn of ["btnRefresh", "btnDelete"] as const) {
      const listeners = adminJs.match(new RegExp(btn + "\\.addEventListener", "g")) || [];
      assert.equal(listeners.length, 1, `${btn} must register exactly one listener`);
      const block = adminJs.match(new RegExp("if \\(" + btn + "\\) \\{[\\s\\S]*?\\n  \\}"));
      assert.ok(block, `${btn} listener must sit inside an if (${btn}) guard`);
      assert.match(block![0], new RegExp(btn + '\\.addEventListener\\("click"'), `${btn} registration guarded`);
      assert.match(block![0], /fetch\(/, `${btn} complete handler body guarded`);
    }
  });
});

describe("owned frontend JS is const/let-only", () => {
  it("zero var declarations in auth.js, app.js, and admin.js", () => {
    assert.ok(!/\bvar\s/.test(authJs), "auth.js still declares var");
    assert.ok(!/\bvar\s/.test(appJs), "app.js still declares var");
    assert.ok(!/\bvar\s/.test(adminJs), "admin.js still declares var");
    assert.match(appJs, /let url = "";/, "localizeAdminUrl url is the single let (reassigned)");
  });
});

describe("auth.js one-shot legacy migration", () => {
  it("init order: fragment bootstrap -> legacy migrations -> WN_AUTH export", () => {
    const boot = authJs.indexOf("(function bootstrapFragmentToken()");
    const migrate = authJs.indexOf("(function migrateLegacySession()");
    const persist = authJs.indexOf("(function migrateLegacyPersistent()");
    const exp = authJs.indexOf("global.WN_AUTH");
    assert.ok(boot > -1 && migrate > -1 && persist > -1 && exp > -1, "init blocks missing");
    assert.ok(boot < migrate && migrate < persist && persist < exp, "unexpected init order");
  });
  it("current credential wins and short-circuits before any legacy read", () => {
    const m = authJs.match(/\(function migrateLegacySession\(\) \{[\s\S]*?\}\)\(\);/);
    assert.ok(m, "migration init missing");
    const body = m[0];
    const currentIdx = body.indexOf("if (readStaged() || readPersistent()) return;");
    const legacyIdx = body.indexOf("sessionStorage.getItem(LEGACY_SESSION)");
    assert.ok(currentIdx > -1 && legacyIdx > -1, "migration must check current before the legacy blob");
    assert.ok(currentIdx < legacyIdx, "current credential must be checked before the legacy blob");
  });
  it("blob tokens are staged (session), never persisted; removal follows a verified stage", () => {
    const m = authJs.match(/\(function migrateLegacySession\(\) \{[\s\S]*?\}\)\(\);/);
    assert.ok(m, "migration init missing");
    const body = m[0];
    assert.ok(!body.includes("localStorage.setItem"), "unknown-scope legacy token must not persist");
    // app.js preview restore still writes token-less wn_last_widget blobs
    const noTokenIdx = body.indexOf("if (!token) return;");
    const stageIdx = body.indexOf("if (!stageToken(token)) return;");
    const removeIdx = body.indexOf("sessionStorage.removeItem(LEGACY_SESSION)");
    assert.ok(noTokenIdx > -1 && stageIdx > -1 && removeIdx > -1, "token guard / staging missing");
    assert.ok(noTokenIdx < stageIdx, "token-less blob must return before any staging");
    assert.ok(stageIdx < removeIdx, "verified stage must precede legacy removal");
    assert.match(body, /sessionStorage\.removeItem\(LEGACY_SESSION_OLD\)/);
  });
  it("legacy plain localStorage tokens stage into session scope without prematurely deleting persistent copy", () => {
    const m = authJs.match(/\(function migrateLegacyPersistent\(\) \{[\s\S]*?\}\)\(\);/);
    assert.ok(m, "persistent format migration missing");
    assert.match(m[0], /if \(!saved \|\| !saved\.legacy\) return;/);
    const stageIdx = m[0].indexOf("stageToken(saved.token)");
    assert.ok(stageIdx > -1, "stage missing");
  });
});

describe("auth.js scoped storage with finite expiry", () => {
  it("getter returns the staged/session token first, then the persistent client key", () => {
    const m = authJs.match(/function getAccessToken\(\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "getAccessToken missing");
    const stagedIdx = m[0].indexOf("readStaged()");
    const persistIdx = m[0].indexOf("readPersistent()");
    assert.ok(stagedIdx > -1 && persistIdx > -1, "getter must read both scopes");
    assert.ok(stagedIdx < persistIdx, "session scope must win for bootstrap");
  });
  it("persistent client keys carry explicit 30-day expiry metadata", () => {
    assert.match(authJs, /CLIENT_TTL_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
    assert.match(authJs, /JSON\.stringify\(\{ token: value, exp: Date\.now\(\) \+ CLIENT_TTL_MS \}\)/);
    assert.match(authJs, /localStorage\.setItem\(KEY, entry\)/);
  });
  it("expired client entries are deleted on read", () => {
    const m = authJs.match(/function readPersistent\(\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "readPersistent missing");
    assert.match(m[0], /saved\.exp > Date\.now\(\)/);
    assert.match(m[0], /localStorage\.removeItem\(KEY\)/);
  });
  it("ambiguous/unrecognized raw data is legacy/unknown, never deleted", () => {
    const m = authJs.match(/function readPersistent\(\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "readPersistent missing");
    assert.equal(m[0].split("localStorage.removeItem(KEY)").length - 1, 1, "only the expired path deletes");
    assert.ok(!m[0].includes("malformed"), "no malformed purge path");
    assert.match(m[0], /saved\.token\.trim\(\) && Number\.isFinite\(saved\.exp\)\) \{/);
    assert.match(m[0], /return \{ token: raw\.trim\(\), legacy: true \};/);
    const recognized = m[0].indexOf("Number.isFinite(saved.exp)");
    const expiredDelete = m[0].indexOf("localStorage.removeItem(KEY)");
    const fallthrough = m[0].indexOf("return { token: raw.trim(), legacy: true };");
    assert.ok(recognized > -1 && expiredDelete > recognized, "delete only inside the recognized branch");
    assert.ok(fallthrough > expiredDelete, "unrecognized data falls through to legacy, not deletion");
  });
  it("only an exact client scope persists; root/missing/unknown stage without touching localStorage", () => {
    const m = authJs.match(/function setAccessToken\(token, scope\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "setAccessToken missing");
    const guardIdx = m[0].indexOf('if (scope !== "client") {');
    assert.ok(guardIdx > -1, "non-client guard missing");
    const branch = m[0].slice(guardIdx, m[0].indexOf("return;", guardIdx));
    assert.ok(!branch.includes("localStorage.removeItem"), "non-client staging must not delete a persistent client record");
    assert.match(branch, /stageToken\(value\)/);
    assert.ok(!branch.includes("localStorage.setItem"), "non-client scopes must never persist");
    assert.ok(
      guardIdx < m[0].indexOf("localStorage.setItem(KEY"),
      "non-client guard must precede the client persist path",
    );
  });
  it("client persist verifies the written entry, then drops the staged copy", () => {
    const m = authJs.match(/function setAccessToken\(token, scope\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "setAccessToken missing");
    const setIdx = m[0].indexOf("localStorage.setItem(KEY");
    const dropIdx = m[0].indexOf("sessionStorage.removeItem(SESSION_KEY)");
    assert.ok(setIdx > -1 && dropIdx > -1, "client persist / staged cleanup missing");
    assert.ok(setIdx < dropIdx, "staged copy must be cleared after the persist");
    assert.match(m[0], /persisted = localStorage\.getItem\(KEY\) === entry;/);
    assert.match(m[0], /sessionStorage\.getItem\(SESSION_KEY\) === value/, "only an identical staged copy is dropped");
  });
  it("a failed or unverified persistent write stages a session fallback instead", () => {
    const m = authJs.match(/function setAccessToken\(token, scope\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "setAccessToken missing");
    const ifIdx = m[0].indexOf("if (persisted) {");
    const elseIdx = m[0].indexOf("} else {", ifIdx);
    assert.ok(ifIdx > -1 && elseIdx > -1, "verified/fallback branches missing");
    assert.match(m[0].slice(elseIdx), /stageToken\(value\)/);
  });
  it("clearAccessToken removes every current and legacy artifact", () => {
    const m = authJs.match(/function clearAccessToken\(\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "clearAccessToken missing");
    assert.match(m[0], /localStorage\.removeItem\(KEY\)/);
    assert.match(m[0], /sessionStorage\.removeItem\(SESSION_KEY\)/);
    assert.match(m[0], /sessionStorage\.removeItem\(LEGACY_SESSION\)/);
    assert.match(m[0], /sessionStorage\.removeItem\(LEGACY_SESSION_OLD\)/);
  });
});

describe("admin.js robust API response reads", () => {
  it("all four authenticated operations share readApiResponse; no raw res.json()", () => {
    assert.match(adminJs, /async function readApiResponse\(res\) \{/);
    const calls = adminJs.match(/await readApiResponse\(res\)/g) || [];
    assert.equal(calls.length, 4, "list/PATCH/refresh/delete must all use readApiResponse");
    assert.ok(!adminJs.includes("res.json()"), "raw res.json() masks non-JSON error bodies");
  });
  it("reads text once, parses only a non-empty body, chains error fallbacks", () => {
    const m = adminJs.match(/async function readApiResponse\(res\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "readApiResponse missing");
    assert.match(m[0], /await res\.text\(\)/);
    assert.match(m[0], /if \(text\) \{/);
    assert.match(m[0], /JSON\.parse\(text\)/);
    assert.match(m[0], /data\.error\)\s*\|\|\s*res\.statusText\s*\|\|\s*"HTTP " \+ res\.status/);
    assert.match(m[0], /if \(!data\) throw new Error\(/);
  });
  it("successful empty body returns a neutral object; non-OK keeps the status fallback", () => {
    const m = adminJs.match(/async function readApiResponse\(res\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "readApiResponse missing");
    const throwIdx = m[0].indexOf("if (!res.ok) {");
    const emptyIdx = m[0].indexOf("if (!text) return {};");
    const garbageIdx = m[0].indexOf("if (!data) throw new Error(");
    assert.ok(throwIdx > -1 && emptyIdx > -1 && garbageIdx > -1, "response guards missing");
    assert.ok(
      throwIdx < emptyIdx && emptyIdx < garbageIdx,
      "empty-success return must sit between the error throw and the garbage guard",
    );
  });
});

describe("admin.js scope-aware persistence after loadWidgets", () => {
  it("only an exact server-confirmed client scope is eligible for persistence", () => {
    const m = adminJs.match(/async function loadWidgets\(\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "loadWidgets missing");
    assert.ok(
      !m[0].includes('data.scope || "client"'),
      "absent/unknown scope must not default to client persistence",
    );
    assert.match(m[0], /if \(data\.scope === "client"\) state\.scope = "client";\s*else if \(data\.scope === "root"\) state\.scope = "root";\s*else state\.scope = "unknown";/);
    assert.ok(!m[0].includes('=== "client" ?'), "nested ternary must be flattened");
    const scopeIdx = m[0].indexOf('state.scope = "client"');
    const saveIdx = m[0].indexOf("saveToken(token, state.scope);");
    assert.ok(scopeIdx > -1 && scopeIdx < saveIdx, "scope normalized before the scoped save");
    assert.match(adminJs, /auth\(\)\.setAccessToken\(token, scope\)/);
  });
});

describe("admin.js clamped numeric fields", () => {
  it("ports the backend clampInt contract (finite-only, round/clamp, fallback)", () => {
    assert.match(adminJs, /function clampInt\(value, min, max, fallback\) \{/);
    assert.match(adminJs, /Number\.isFinite/);
    assert.match(adminJs, /Math\.min\(max, Math\.max\(min, Math\.round/);
  });
  it("no raw Number(edit-num); blank/invalid preserves the current value", () => {
    assert.ok(
      !/Number\(document\.getElementById\("edit-num"\)/.test(adminJs),
      "raw Number(edit-num) sends 0 on blank input",
    );
    assert.match(
      adminJs,
      /clampInt\(document\.getElementById\("edit-num"\)\.value, 1, 20, currentNumResults\(\)\)/,
    );
    assert.match(
      adminJs,
      /clampInt\(document\.getElementById\("edit-limit"\)\.value, 1, 50, currentWidgetLimit\(\)\)/,
    );
    // current values derive from the loaded widget in state, with 10/5 fallbacks
    assert.match(adminJs, /state\.widgets\.find/);
    assert.match(adminJs, /w\.publicId === state\.publicId/);
    assert.match(adminJs, /clampInt\(w\.numResults, 1, 20, 10\)/);
    assert.match(adminJs, /clampInt\(w\.widgetLimit, 1, 50, 5\)/);
  });
});

describe("app.js blank-safe numResults", () => {
  it("create payload clamps a finite integer to 1..20 with fallback 10", () => {
    assert.match(appJs, /clampInt\(document\.getElementById\("numResults"\)\.value, 1, 20, 10\)/);
    assert.ok(
      !/Number\(document\.getElementById\("numResults"\)/.test(appJs),
      "raw Number(numResults) sends 0 on blank input",
    );
  });
  it("local clampInt helper is finite-only and blank-safe", () => {
    const m = appJs.match(/function clampInt\(value, min, max, fallback\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "app.js clampInt helper missing");
    assert.match(m[0], /if \(!trimmed\) return fallback;/);
    assert.match(m[0], /Number\.isFinite/);
    assert.match(m[0], /Math\.min\(max, Math\.max\(min, Math\.round/);
  });
});

describe("app.js polling timer ordering", () => {
  it("interval handle is assigned before the immediate tick can clear it", () => {
    const m = appJs.match(/setTimeout\(function \(\) \{[\s\S]*?\}, 2000\);/);
    assert.ok(m, "initial 2s poll delay missing");
    const assignIdx = m[0].indexOf("state.pollTimer = setInterval(tick, 3000);");
    const tickIdx = m[0].indexOf("tick();");
    assert.ok(assignIdx > -1 && tickIdx > -1, "poll timer setup missing");
    assert.ok(assignIdx < tickIdx, "handle must exist before the first tick runs — no orphan timer");
  });
});

describe("admin.js login deduplication", () => {
  it("a login requested mid-flight is queued after settle — never discarded", () => {
    assert.match(adminJs, /let loginFlight = null;/);
    assert.match(adminJs, /function requestLogin\(run\) \{/);
    assert.ok(!/if \(loginFlight\) return loginFlight;/.test(adminJs), "caller must not be dropped");
    const m = adminJs.match(/function requestLogin\(run\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "requestLogin missing");
    assert.match(m[0], /loginFlight\.catch\(function \(\) \{\}\)\.then/, "queues after settle, failure included");
    assert.match(m[0], /return requestLogin\(run\);/, "queued run re-enters under its own busy state");
    assert.match(m[0], /if \(loginFlight === tracked\) loginFlight = null;/, "identity-guarded reset");
    const calls = adminJs.match(/requestLogin\(async function \(\) \{/g) || [];
    assert.equal(calls.length, 2, "auto-login and submit must both route through requestLogin");
  });
  it("queued runs execute after settle, success or failure, never concurrently", async () => {
    const m = adminJs.match(/let loginFlight = null;\s*function requestLogin\(run\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "login flight block missing");
    const requestLogin: (run: () => Promise<void>) => Promise<void> = new Function(
      "withBusy", "loadBtn", "t", m[0] + "; return requestLogin;",
    )(async (_b: unknown, _l: string, fn: () => Promise<void>) => fn(), {}, () => "x");
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const first = requestLogin(async () => { order.push("a1"); await gate; order.push("a2"); });
    const queued = requestLogin(async () => { order.push("b"); });
    assert.deepEqual(order, ["a1"], "queued run must not start during the flight");
    release();
    await Promise.all([first, queued]);
    assert.deepEqual(order, ["a1", "a2", "b"], "queued run executes after settle");
    const failed = requestLogin(async () => { throw new Error("boom"); });
    const after = requestLogin(async () => { order.push("c"); });
    await assert.rejects(failed, /boom/);
    await after;
    assert.equal(order[3], "c", "queued run still executes after a failed flight");
  });
  it("the shared busy button is toggled exactly once per login run", () => {
    const busy = adminJs.match(/withBusy\(loadBtn/g) || [];
    assert.equal(busy.length, 1, "loadBtn busy state must be owned by the shared flight only");
    const loads = adminJs.match(/await loadWidgets\(\)/g) || [];
    assert.equal(loads.length, 2, "submit and auto-login each load once via the shared flight");
  });
});

describe("admin.js empty successful PATCH keeps the loaded widget", () => {
  it("only a response echoing the loaded publicId is merged and re-rendered", () => {
    const m = adminJs.match(/getElementById\("edit-form"\)[\s\S]*?showOk\(t\("saved_ok"\)\)/);
    assert.ok(m, "PATCH submit handler missing");
    const guardIdx = m[0].indexOf("if (data && data.publicId && data.publicId === state.publicId) {");
    assert.ok(guardIdx > -1, "valid-publicId guard missing — fill({}) would destroy identity");
    const fillIdx = m[0].indexOf("fill(data);", guardIdx);
    const okIdx = m[0].indexOf('showOk(t("saved_ok"))', fillIdx);
    assert.ok(guardIdx < fillIdx && fillIdx < okIdx, "merge/fill guarded; success still reported");
    assert.match(m[0].slice(guardIdx, fillIdx), /state\.widgets = state\.widgets\.map/);
  });
});

describe("app.js poll start handle tracking", () => {
  it("clearPollTimers clears both the pending start delay and the live interval", () => {
    const c = appJs.match(/function clearPollTimers\(\) \{[\s\S]*?\n  \}/);
    assert.ok(c, "clearPollTimers missing");
    assert.match(c[0], /clearTimeout\(state\.pollStartTimer\)/);
    assert.match(c[0], /clearInterval\(state\.pollTimer\)/);
  });
  it("pollSync clears both handles at start and at every terminal branch", () => {
    const p = appJs.match(/async function pollSync\(maxAttempts\) \{[\s\S]*?\}, 2000\);\n  \}/);
    assert.ok(p, "pollSync missing");
    assert.match(p[0], /state\.pollStartTimer = setTimeout\(/);
    assert.equal((p[0].match(/clearPollTimers\(\)/g) || []).length, 3, "start + synced + timeout");
    assert.ok(!p[0].includes("clearInterval(state.pollTimer)"), "raw clear bypasses the start handle");
  });
  it("state reconstruction preserves both poll handles", () => {
    const a = appJs.match(/function applyWidgetResponse\(data, opts\) \{[\s\S]*?\n  \}/);
    assert.ok(a, "applyWidgetResponse missing");
    assert.match(a[0], /pollTimer: state\.pollTimer,/);
    assert.match(a[0], /pollStartTimer: state\.pollStartTimer,/);
    assert.equal((appJs.match(/pollStartTimer: null,/g) || []).length, 2, "initial + restored state");
  });
});

describe("app.js widget creation token persists as client scope", () => {
  it("saveToken passes the explicit client scope for POST /api/widgets keys", () => {
    assert.match(appJs, /auth\(\)\.setAccessToken\(token, "client"\)/);
    assert.ok(!/setAccessToken\(token\)/.test(appJs), "scope-less save would turn session-only");
  });
});

describe("auth.js runtime storage behavior (mocked Web Storage)", () => {
  type Store = Record<string, string>;
  const storage = (s: Store, fail: boolean) => ({
    getItem: (k: string) => (k in s ? s[k] : null),
    setItem: (k: string, v: string) => {
      if (fail) throw new Error("storage denied");
      s[k] = String(v);
    },
    removeItem: (k: string) => {
      delete s[k];
    },
  });
  const loadAuth = (o: { local?: Store; session?: Store; failLocal?: boolean; failSession?: boolean }) => {
    const local: Store = { ...o.local };
    const session: Store = { ...o.session };
    const window: { WN_AUTH?: any } = {};
    new Function("window", "localStorage", "sessionStorage", "location", "history", authJs)(
      window,
      storage(local, !!o.failLocal),
      storage(session, !!o.failSession),
      { hash: "", pathname: "/", search: "" },
      { replaceState: () => {} },
    );
    return { auth: window.WN_AUTH as any, local, session };
  };
  it("failed persistent client write keeps the token as a session fallback", () => {
    const { auth, local, session } = loadAuth({ failLocal: true });
    auth.setAccessToken("k1", "client");
    assert.equal(local.wn_access_token, undefined);
    assert.equal(session.wn_session_token, "k1");
    assert.equal(auth.getAccessToken(), "k1");
  });
  it("verified client write persists with expiry and clears an identical staged copy", () => {
    const { auth, local, session } = loadAuth({ session: { wn_session_token: "k2" } });
    auth.setAccessToken("k2", "client");
    const saved = JSON.parse(local.wn_access_token);
    assert.equal(saved.token, "k2");
    assert.ok(saved.exp > Date.now());
    assert.equal(session.wn_session_token, undefined);
    assert.equal(auth.getAccessToken(), "k2");
  });
  it("a different staged credential survives a verified client persist", () => {
    const { auth, local, session } = loadAuth({ session: { wn_session_token: "newer" } });
    auth.setAccessToken("k2", "client");
    assert.equal(JSON.parse(local.wn_access_token).token, "k2");
    assert.equal(session.wn_session_token, "newer", "unrelated staged credential preserved");
    assert.equal(auth.getAccessToken(), "newer", "staged credential still wins reads");
  });
  it("root, missing, and unknown scopes stage session-only without touching a client record", () => {
    const record = JSON.stringify({ token: "old", exp: Date.now() + 1e5 });
    for (const scope of ["root", "legacy-unknown", undefined]) {
      const { auth, local, session } = loadAuth({ local: { wn_access_token: record } });
      auth.setAccessToken("k3", scope);
      assert.equal(local.wn_access_token, record, `scope ${scope} must preserve the client record`);
      assert.equal(session.wn_session_token, "k3");
      assert.equal(auth.getAccessToken(), "k3");
    }
  });
  it("legacy persistent token is staged into session while preserving persistent copy", () => {
    const denied = loadAuth({ local: { wn_access_token: "legacy" }, failSession: true });
    assert.equal(denied.local.wn_access_token, "legacy", "sole copy kept when staging fails");
    assert.equal(denied.auth.getAccessToken(), "legacy");
    const ok = loadAuth({ local: { wn_access_token: "legacy" } });
    assert.equal(ok.local.wn_access_token, "legacy");
    assert.equal(ok.session.wn_session_token, "legacy");
    assert.equal(ok.auth.getAccessToken(), "legacy");
    const wins = loadAuth({
      local: { wn_access_token: "legacy" },
      session: { wn_session_token: "staged" },
    });
    assert.equal(wins.local.wn_access_token, "legacy");
    assert.equal(wins.session.wn_session_token, "staged");
  });
  it("unknown-exp is staged legacy; finite-past deleted; sole copy survives stage failure", () => {
    for (const raw of ['{"token":"m1"}', '{"token":"m2","exp":"soon"}']) {
      const r = loadAuth({ local: { wn_access_token: raw } });
      assert.equal(r.local.wn_access_token, raw, "persistent copy preserved until client save");
      assert.equal(r.session.wn_session_token, raw, "raw trimmed value staged as legacy");
    }
    const dead = loadAuth({ local: { wn_access_token: '{"token":"x","exp":1}' } });
    assert.equal(dead.local.wn_access_token, undefined, "genuinely expired entry deleted on read");
    assert.equal(dead.auth.getAccessToken(), "", "only finite exp <= now is genuinely expired");
    const live = loadAuth({ local: { wn_access_token: '{"token":"y","exp":9e15}' } });
    assert.ok(live.local.wn_access_token && live.auth.getAccessToken() === "y", "live key kept");
    const denied = loadAuth({ local: { wn_access_token: '{"token":"sole"}' }, failSession: true });
    assert.ok(denied.local.wn_access_token, "sole copy kept when staging fails");
  });
  it("denied stage keeps an ambiguous persistent copy untouched", () => {
    const denied = loadAuth({ local: { wn_access_token: '{"token":"abc' }, failSession: true });
    assert.equal(denied.local.wn_access_token, '{"token":"abc', "ambiguous copy kept when staging fails");
    assert.equal(denied.session.wn_session_token, undefined);
    assert.equal(denied.auth.getAccessToken(), '{"token":"abc', "legacy raw still readable");
  });
});

describe("preview null-host/button guards", () => {
  it("admin.js showPreview bails before classList/mount when #preview is missing", () => {
    const m = adminJs.match(/function showPreview\(publicId, appearance\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "showPreview missing");
    const g = m[0].indexOf("if (!host) return;");
    assert.ok(g > -1 && g < m[0].indexOf("host.classList.add"), "guard precedes classList/mount");
  });
  it("app.js mountPreview unhide and reload click registration are guarded", () => {
    const m = appJs.match(/function mountPreview\(publicId, appearance\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "mountPreview missing");
    assert.match(m[0], /if \(reloadPreview\) reloadPreview\.hidden = false;/);
    assert.match(appJs, /if \(reloadPreview\) reloadPreview\.addEventListener\("click"/);
  });
});

describe("app.js setThemeUI theme reflection", () => {
  const norm = appJs.match(/function normalizeTheme\(theme\) \{[\s\S]*?\n  \}/);
  const setUI = appJs.match(/function setThemeUI\(theme\) \{[\s\S]*?\n  \}/);
  it("normalizes to site/light/dark, updating the input and active segment", () => {
    assert.ok(norm && setUI, "setThemeUI helper missing");
    const input = { value: "" };
    const mkBtn = (v: string) => {
      const btn: { isActive: boolean; getAttribute: () => string; classList: object } = {
        isActive: false,
        getAttribute: () => v,
        classList: { toggle: (_c: string, on: boolean) => { btn.isActive = !!on; } },
      };
      return btn;
    };
    const btns = ["site", "light", "dark"].map(mkBtn);
    const setThemeUI = new Function("themeInput", "themeSegment", norm![0] + "\n" + setUI![0] + "; return setThemeUI;")(
      input, { querySelectorAll: () => btns }) as (theme: string) => void;
    setThemeUI("dark");
    assert.equal(input.value, "dark");
    assert.deepEqual(btns.map((b) => b.isActive), [false, false, true]);
    setThemeUI("junk");
    assert.equal(input.value, "site", "unknown themes normalize to site");
    assert.deepEqual(btns.map((b) => b.isActive), [true, false, false]);
  });
  it("invoked at initial setup, applyWidgetResponse, and session restore before mount", () => {
    assert.equal((appJs.match(/setThemeUI\(state\.theme\);/g) || []).length, 3, "setup + response + restore");
    const a = appJs.match(/function applyWidgetResponse\(data, opts\) \{[\s\S]*?\n  \}/);
    assert.ok(a, "applyWidgetResponse missing");
    const ui = a[0].indexOf("setThemeUI(state.theme);");
    assert.ok(ui > a[0].indexOf("state = {"), "theme UI follows the state rebuild");
    assert.ok(ui > -1 && ui < a[0].indexOf("mountPreview(state.publicId"), "UI reflects theme before preview mount");
    const restoreUi = appJs.lastIndexOf("setThemeUI(state.theme);");
    assert.ok(restoreUi > -1 && restoreUi < appJs.lastIndexOf("mountPreview(state.publicId"), "restored theme reflected before mount");
  });
});

describe("app.js home logout ordering", () => {
  it("poll timers clear before the credential is dropped and navigation", () => {
    const m = appJs.match(/btnLogoutHome\.addEventListener\("click"[\s\S]*?\n    \}\);/);
    assert.ok(m, "home logout handler missing");
    const timers = m[0].indexOf("clearPollTimers();");
    const token = m[0].indexOf("clearToken();");
    assert.ok(timers > -1 && token > -1 && timers < token, "clearPollTimers must precede clearToken");
  });
});

describe("admin.js API errors carry the HTTP status", () => {
  const m = adminJs.match(/async function readApiResponse\(res\) \{[\s\S]*?\n  \}/);
  const readApiResponse: (res: any) => Promise<any> = new Function(m![0] + "; return readApiResponse;")();
  const res = (status: number, body: string, statusText = "") => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => body,
  });
  it("non-OK reads throw with err.status and chained message fallbacks", async () => {
    await assert.rejects(readApiResponse(res(401, '{"error":"unauthorized"}')), (e: any) => e.status === 401 && e.message === "unauthorized");
    await assert.rejects(readApiResponse(res(403, "", "Forbidden")), (e: any) => e.status === 403 && e.message === "Forbidden");
    await assert.rejects(readApiResponse(res(503, "<html>upstream</html>")), (e: any) => e.status === 503 && e.message === "HTTP 503");
    assert.deepEqual(await readApiResponse(res(200, "")), {}, "empty success stays neutral");
  });
});

describe("admin.js auto-login clears stored credentials only on 401/403", () => {
  const m = adminJs.match(/requestLogin\(async function \(\) \{\s*try \{\s*await loadWidgets\(\);\s*\} catch \(err\) \{([\s\S]*?)\n      \}\s*\}\);/);
  it("captures the auto-login catch (submit's showOk keeps it distinct), guarded to 401/403", () => {
    assert.ok(m, "auto-login catch block missing");
    assert.match(m![1], /err\.status === 401 \|\| err\.status === 403/);
    assert.match(m![1], /&& getStoredToken\(\)\) \{\s*clearToken\(\);\s*document\.getElementById\("token"\)\.value = "";/);
  });
  const run = async (err: any, stored: string) => {
    const cleared: string[] = [];
    const input = { value: stored };
    const loadErr = { textContent: "", hidden: true };
    const handler: (e: any) => Promise<void> = new Function(
      "getStoredToken", "clearToken", "document", "loadErr",
      "return async function (err) {" + m![1] + "};",
    )(() => stored, () => { cleared.push("clearToken"); }, { getElementById: () => input }, loadErr);
    await handler(err);
    return { cleared, input, loadErr };
  };
  it("401 and 403 drop the stored credential and the token input, showing the error", async () => {
    for (const status of [401, 403]) {
      const r = await run(Object.assign(new Error("rejected"), { status }), "k");
      assert.deepEqual(r.cleared, ["clearToken"], `${status} must clear the stored credential`);
      assert.equal(r.input.value, "");
      assert.equal(r.loadErr.textContent, "rejected");
      assert.equal(r.loadErr.hidden, false);
    }
  });
  it("network errors (no status) and 5xx preserve the stored credential", async () => {
    for (const err of [new TypeError("fetch failed"), Object.assign(new Error("down"), { status: 503 })]) {
      const r = await run(err, "k");
      assert.deepEqual(r.cleared, [], `${err.message} must preserve the stored credential`);
      assert.equal(r.input.value, "k");
      assert.equal(r.loadErr.textContent, err.message);
      assert.equal(r.loadErr.hidden, false);
    }
  });
  it("a 401/403 with nothing left in storage does not re-clear", async () => {
    const r = await run(Object.assign(new Error("rejected"), { status: 401 }), "");
    assert.deepEqual(r.cleared, [], "empty storage must not trigger clearToken");
    assert.equal(r.input.value, "");
  });
});

describe("auth.js ambiguous persistent entries migrate as legacy, never purged", () => {
  type Store = Record<string, string>;
  const storage = (s: Store) => ({
    getItem: (k: string) => (k in s ? s[k] : null),
    setItem: (k: string, v: string) => {
      s[k] = String(v);
    },
    removeItem: (k: string) => {
      delete s[k];
    },
  });
  const loadAuth = (local: Store) => {
    const l: Store = { ...local };
    const s: Store = {};
    const window: { WN_AUTH?: any } = {};
    new Function("window", "localStorage", "sessionStorage", "location", "history", authJs)(
      window,
      storage(l),
      storage(s),
      { hash: "", pathname: "/", search: "" },
      { replaceState: () => {} },
    );
    return { auth: window.WN_AUTH as any, local: l, session: s };
  };
  it("ambiguous or legacy values are staged verbatim and preserved until client save", () => {
    for (const raw of ['{"token":"abc', '{"exp":1}', '[1,2', '["token"]', "12345", "null"]) {
      const r = loadAuth({ wn_access_token: raw });
      assert.equal(r.session.wn_session_token, raw, `ambiguous value staged verbatim: ${raw}`);
      assert.equal(r.local.wn_access_token, raw, `persistent copy preserved until client save: ${raw}`);
      assert.equal(r.auth.getAccessToken(), raw, `ambiguous value readable as legacy: ${raw}`);
    }
    const ok = loadAuth({ wn_access_token: "plain-legacy-token" });
    assert.equal(ok.local.wn_access_token, "plain-legacy-token", "persistent copy preserved until client save");
    assert.equal(ok.session.wn_session_token, "plain-legacy-token");
    assert.equal(ok.auth.getAccessToken(), "plain-legacy-token");
  });
  it("root or unknown setAccessToken stages session token without deleting existing persistent client token", () => {
    const r = loadAuth({ wn_access_token: JSON.stringify({ token: "client-key", exp: Date.now() + 100000 }) });
    r.auth.setAccessToken("root-token", "root");
    assert.equal(r.session.wn_session_token, "root-token", "root token staged");
    assert.ok(r.local.wn_access_token.includes("client-key"), "persistent client key preserved");
    assert.equal(r.auth.getAccessToken(), "root-token", "staged session token wins for getter");
  });
});

describe("DOM null guards and non-object restore", () => {
  it("app.js has null guards on copyEmbedBtn, statusLine, and admin elements", () => {
    assert.match(appJs, /if \(copyEmbedBtn\)/);
    assert.match(appJs, /if \(statusLine\)/);
    assert.match(appJs, /if \(adminTokenEl\)/);
    assert.match(appJs, /if \(adminLinkEl\)/);
    assert.match(appJs, /if \(openAdmin\)/);
    assert.match(appJs, /if \(feedUrlEl\)/);
    assert.match(appJs, /if \(embedCodeEl\)/);
  });
  it("admin.js has null guards on loadForm, editForm, btnRefresh, and btnDelete", () => {
    assert.match(adminJs, /if \(loadForm\)/);
    assert.match(adminJs, /if \(editForm\)/);
    assert.match(adminJs, /if \(btnRefresh\)/);
    assert.match(adminJs, /if \(btnDelete\)/);
  });
  it("app.js session restore safely handles non-object JSON values", () => {
    assert.match(appJs, /typeof saved === "object" && !Array\.isArray\(saved\)/);
  });
});

describe("app.js one-time token visibility follows the current submit attempt", () => {
  const applySrc = appJs.match(/function applyWidgetResponse\(data, opts\) \{[\s\S]*?\n  \}/);
  assert.ok(applySrc, "applyWidgetResponse missing");
  const runApply = (data: any, existingKey: string, stickyReused: boolean) => {
    const shown: boolean[] = [];
    const el = { value: "", href: "", hidden: true, removeAttribute: () => {} };
    const applyWidgetResponse = new Function(
      "state", "getStoredToken", "saveToken", "document", "localizeAdminUrl", "updateTokenBlockUI",
      "signedInBanner", "resultCard", "setFlowStep", "persistState", "setThemeUI", "mountPreview",
      applySrc![0] + "; return applyWidgetResponse;",
    )(
      {
        adminToken: existingKey || null, pollTimer: null, pollStartTimer: null,
        theme: "site", widgetLimit: 5, title: "", borderless: false, showSummaries: true,
        reusedKey: stickyReused,
      },
      () => "", () => {},
      { getElementById: () => el }, () => "", (reused: boolean) => { shown.push(reused); },
      el, el, () => {}, () => {}, () => {}, () => {},
    );
    applyWidgetResponse(data, { mount: false, existingKey: existingKey });
    return shown;
  };
  const fresh = { id: "i", publicId: "p", accessToken: "new-token", feedUrl: "f" };
  it("a fresh accessToken without an existing key shows the one-time token", () => {
    assert.deepEqual(runApply(fresh, "", false), [false], "token row must be visible");
  });
  it("a fresh mint resets a sticky reusedKey from an earlier attempt", () => {
    assert.deepEqual(runApply(fresh, "", true), [false], "sticky reuse must not hide a new token");
  });
  it("an existing key echoed unchanged hides the one-time token", () => {
    assert.deepEqual(runApply({ ...fresh, accessToken: "same-key" }, "same-key", false), [true]);
    assert.deepEqual(runApply({ ...fresh, accessToken: "same-key" }, "same-key", true), [true]);
  });
  it("a rotated token (existing key sent, different token back) still shows once", () => {
    assert.deepEqual(runApply(fresh, "old-key", true), [false]);
  });
  it("the submit attempt passes its key via opts and never pre-sets sticky state", () => {
    assert.match(appJs, /applyWidgetResponse\(data, \{ mount: true, existingKey: existingKey \}\)/);
    assert.ok(!appJs.includes("state.reusedKey = true"), "sticky flag must not be set pre-flight");
    assert.ok(!applySrc![0].includes("state.reusedKey ||"), "sticky flag must not be OR-ed in");
  });
  it("updateTokenBlockUI hides the token row only for a reused key", () => {
    const m = appJs.match(/function updateTokenBlockUI\(reused\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "updateTokenBlockUI missing");
    const tokenRow = { hidden: false };
    const updateTokenBlockUI = new Function(
      "document", "tokenRow", "t", m![0] + "; return updateTokenBlockUI;",
    )({ getElementById: () => ({ textContent: "" }) }, tokenRow, (k: string) => k);
    updateTokenBlockUI(true);
    assert.equal(tokenRow.hidden, true, "reused key keeps the token hidden");
    updateTokenBlockUI(false);
    assert.equal(tokenRow.hidden, false, "fresh key shows the one-time token");
  });
});

describe("embed load failure clears the preview loading state and still reports", () => {
  const classList = (initial: string[]) => {
    const set = new Set(initial);
    return { add: (c: string) => set.add(c), remove: (c: string) => set.delete(c), has: (c: string) => set.has(c) };
  };
  const failingScriptDoc = (hostId: string, host: any) => ({
    getElementById: (id: string) => (id === hostId ? host : null),
    createElement: () => ({}) as any,
    body: { appendChild: (s: any) => s.onerror() },
  });
  it("app.js drops preview-host is-loading and reports an err status", () => {
    const m = appJs.match(/function ensureEmbed\(cb\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "app.js ensureEmbed missing");
    const list = classList(["is-loading"]);
    const host = { classList: list };
    const statuses: string[][] = [];
    const ensureEmbed = new Function(
      "window", "document", "setSyncStatus", "t", m![0] + "; return ensureEmbed;",
    )({}, failingScriptDoc("preview-host", host), (text: string, kind: string) => {
      statuses.push([text, kind]);
    }, (k: string) => k);
    let mounted = false;
    ensureEmbed(() => {
      mounted = true;
    });
    assert.equal(list.has("is-loading"), false, "loading state removed");
    assert.deepEqual(statuses, [["sync_embed_fail", "err"]], "error still reported");
    assert.equal(mounted, false, "mount callback must not run");
  });
  it("admin.js drops #preview is-loading and still shows the error", () => {
    const m = adminJs.match(/function ensureEmbed\(cb\) \{[\s\S]*?\n  \}/);
    assert.ok(m, "admin.js ensureEmbed missing");
    const list = classList(["is-loading"]);
    const host = { classList: list };
    const errors: string[] = [];
    const ensureEmbed = new Function(
      "window", "document", "showErr", "t", m![0] + "; return ensureEmbed;",
    )({}, failingScriptDoc("preview", host), (msg: string) => {
      errors.push(msg);
    }, (k: string) => k);
    ensureEmbed(() => {});
    assert.equal(list.has("is-loading"), false, "loading state removed");
    assert.deepEqual(errors, ["sync_embed_fail"], "error still reported");
  });
});
