/**
 * Access credential persistence with split scopes:
 * - Persistent client key (localStorage): client-scoped widget keys only, with
 *   explicit 30-day expiry metadata; expired entries are deleted on read.
 * - Session credential (sessionStorage): staged `#token=` deep links, legacy
 *   tokens of unknown scope, and root tokens. Root credentials stay
 *   session-only and never written to localStorage — Web Storage is readable
 *   by any page JavaScript (OWASP), so nothing indefinite or root-equivalent
 *   may persist there. sessionStorage ends with the tab session.
 * The raw token is never exposed globally.
 */
(function (global) {
  "use strict";

  const KEY = "wn_access_token";
  const SESSION_KEY = "wn_session_token";
  const LEGACY_SESSION = "wn_last_widget";
  const LEGACY_SESSION_OLD = "nw_last_widget";
  const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // persistent client keys: 30 days

  // Session-scoped credential: staged deep link, unknown-scope legacy token, or
  // confirmed root token. "" when nothing is staged.
  function readStaged() {
    try {
      const t = sessionStorage.getItem(SESSION_KEY);
      if (t && t.trim()) return t.trim();
    } catch (_) {}
    return "";
  }

  // Stage a credential for this tab session only; true once verified readable.
  function stageToken(token) {
    try {
      sessionStorage.setItem(SESSION_KEY, token);
      return sessionStorage.getItem(SESSION_KEY) === token;
    } catch (_) {
      return false;
    }
  }

  // Persistent client entry. Only a recognized structured {token, exp} entry
  // is scope-known: live returns the token; expired is deleted on read. All
  // other raw data is ambiguous — never deleted; it returns trimmed as a
  // legacy token and migrates only after a verified session stage.
  function readPersistent() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (_) {}
    if (!raw || !raw.trim()) return null;
    // Only a leading { or [ marks a structured entry; every other string is a
    // legacy plain token — even when JSON.parse succeeds on a scalar like
    // "12345", "true", "false", or "null".
    const plain = raw.trim();
    if (plain.charAt(0) !== "{" && plain.charAt(0) !== "[") {
      return { token: plain, legacy: true };
    }
    try {
      const saved = JSON.parse(raw);
      if (saved && typeof saved.token === "string" && saved.token.trim() && Number.isFinite(saved.exp)) {
        if (saved.exp > Date.now()) {
          return { token: saved.token.trim(), legacy: false };
        }
        try {
          localStorage.removeItem(KEY);
        } catch (_) {}
        return null;
      }
    } catch (_) {}
    return { token: raw.trim(), legacy: true };
  }

  // Fragment bootstrap: `#token=` deep links are unknown scope, so the token is
  // staged in sessionStorage — persisted only after the API confirms client
  // scope. An existing stored credential wins over the deep link. auth.js loads
  // first (before i18n/app/admin). Query-string tokens are never consumed.
  (function bootstrapFragmentToken() {
    let hasToken = false;
    let token = "";
    let remainingHash = "";
    try {
      const hash = location.hash || "";
      if (hash.length > 1) {
        const params = new URLSearchParams(hash.slice(1));
        hasToken = params.has("token");
        token = (params.get("token") || "").trim();
        params.delete("token");
        const remaining = params.toString();
        if (remaining) remainingHash = "#" + remaining;
      }
    } catch (_) {}
    // Honor a current credential — never overwrite it. On read failure skip the
    // write; the scrub below still runs.
    if (token && !readPersistent() && !readStaged()) {
      stageToken(token);
    }
    // Unconditional scrub of every token-bearing fragment: even an empty
    // `#token=` must never linger in the URL. Other fragments stay untouched.
    if (!hasToken) return;
    try {
      history.replaceState({}, "", location.pathname + location.search + remainingHash);
    } catch (_) {}
  })();

  // One-shot legacy migration: lift a token out of the old sessionStorage widget
  // blob. Scope is unknown, so it is staged — localStorage persistence happens
  // only after a successful client auth (30-day client policy). Runs after the
  // fragment bootstrap and before the WN_AUTH export.
  (function migrateLegacySession() {
    // A current credential (staged or persistent) wins: never migrate over it.
    if (readStaged() || readPersistent()) return;
    let raw = null;
    try {
      raw = sessionStorage.getItem(LEGACY_SESSION) || sessionStorage.getItem(LEGACY_SESSION_OLD);
    } catch (_) {}
    if (!raw) return;
    let token = "";
    try {
      const saved = JSON.parse(raw);
      if (saved && saved.token) token = String(saved.token).trim();
    } catch (_) {}
    // Token-less blobs are still used by app.js for preview restore — keep them.
    if (!token) return;
    // Only remove the legacy keys after the staged value is verified.
    if (!stageToken(token)) return;
    try {
      sessionStorage.removeItem(LEGACY_SESSION);
      sessionStorage.removeItem(LEGACY_SESSION_OLD);
    } catch (_) {}
  })();

  // One-shot format migration: a legacy plain-string localStorage token has no
  // scope/expiry metadata, so it moves to the session scope until a successful
  // client auth re-persists it under the 30-day client policy.
  (function migrateLegacyPersistent() {
    const saved = readPersistent();
    if (!saved || !saved.legacy) return;
    if (!readStaged()) stageToken(saved.token);
  })();

  // Session credential first (bootstrap + root scope), then the persistent
  // client key; readPersistent already deleted any expired entry.
  function getAccessToken() {
    const staged = readStaged();
    if (staged) return staged;
    const saved = readPersistent();
    return saved ? saved.token : "";
  }

  // Only an exact scope "client" is eligible for finite localStorage
  // persistence (30-day expiry); an identical staged copy is dropped after a
  // verified write so it cannot shadow the key (a different one is kept).
  // Root, missing, or unknown scopes stay
  // session-only — staged without deleting an existing persistent client
  // record. A failed or unverifiable
  // persistent write stages the token as a session fallback instead — the
  // authenticated credential is never dropped.
  function setAccessToken(token, scope) {
    if (!token) return;
    const value = String(token).trim();
    if (!value) return;
    if (scope !== "client") {
      stageToken(value);
      return;
    }
    let persisted = false;
    try {
      const entry = JSON.stringify({ token: value, exp: Date.now() + CLIENT_TTL_MS });
      localStorage.setItem(KEY, entry);
      persisted = localStorage.getItem(KEY) === entry;
    } catch (_) {}
    if (persisted) {
      // Only an identical staged copy is dropped; a different staged
      // credential (e.g. a newer deep link) must keep shadowing the key.
      try {
        if (sessionStorage.getItem(SESSION_KEY) === value) {
          sessionStorage.removeItem(SESSION_KEY);
        }
      } catch (_) {}
    } else {
      stageToken(value);
    }
  }

  // Clear every current and legacy token artifact.
  function clearAccessToken() {
    try {
      localStorage.removeItem(KEY);
    } catch (_) {}
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(LEGACY_SESSION);
      sessionStorage.removeItem(LEGACY_SESSION_OLD);
    } catch (_) {}
  }

  function hasAccessToken() {
    return Boolean(getAccessToken());
  }

  global.WN_AUTH = {
    KEY: KEY,
    getAccessToken: getAccessToken,
    setAccessToken: setAccessToken,
    clearAccessToken: clearAccessToken,
    hasAccessToken: hasAccessToken,
  };
})(typeof window !== "undefined" ? window : globalThis);
