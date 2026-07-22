/**
 * Client access key persistence (permanent until logout).
 * - Access key: settings/stats for widget(s) bound to it
 * - Root token: full system control (same storage; scope decided by API)
 */
(function (global) {
  "use strict";

  var KEY = "wn_access_token";
  var LEGACY_SESSION = "wn_last_widget";
  var LEGACY_SESSION_OLD = "nw_last_widget";

  function getAccessToken() {
    try {
      var t = localStorage.getItem(KEY);
      if (t && t.trim()) return t.trim();
    } catch (_) {}
    // Migrate one-shot from older sessionStorage widget blob
    try {
      var raw = sessionStorage.getItem(LEGACY_SESSION) || sessionStorage.getItem(LEGACY_SESSION_OLD);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.token) {
          setAccessToken(saved.token);
          return String(saved.token).trim();
        }
      }
    } catch (_) {}
    return "";
  }

  function setAccessToken(token) {
    if (!token || !String(token).trim()) return;
    try {
      localStorage.setItem(KEY, String(token).trim());
    } catch (_) {}
  }

  function clearAccessToken() {
    try {
      localStorage.removeItem(KEY);
    } catch (_) {}
    try {
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
