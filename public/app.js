(function () {
  function t(key, vars) {
    return window.WN_I18N ? window.WN_I18N.t(key, vars) : key;
  }
  function localeHref(path) {
    return window.WN_I18N && window.WN_I18N.href ? window.WN_I18N.href(path) : path;
  }
  function auth() {
    return window.WN_AUTH || null;
  }
  function getStoredToken() {
    return auth() ? auth().getAccessToken() : "";
  }
  function saveToken(token) {
    // app.js only handles widget client access keys (POST /api/widgets
    // mints/reuses a client key, never a root token) — persist as "client".
    if (auth() && token) auth().setAccessToken(token, "client");
  }
  function clearToken() {
    if (auth()) auth().clearAccessToken();
  }

  // Logged-in users land in dashboard — stay on builder with ?new=1 or a
  // same-tab compose flag (so language switch / refresh do not dump them
  // into admin mid-form). ?new=1 stays in the URL until a successful create.
  const COMPOSE_KEY = "wn_compose";
  const params = new URLSearchParams(location.search);
  const forceNew = params.get("new") === "1" || params.get("new") === "true";
  function isComposing() {
    if (forceNew) return true;
    try {
      return sessionStorage.getItem(COMPOSE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }
  function setComposing(on) {
    try {
      if (on) sessionStorage.setItem(COMPOSE_KEY, "1");
      else sessionStorage.removeItem(COMPOSE_KEY);
    } catch (_) {}
  }
  if (forceNew) setComposing(true);
  const storedToken = getStoredToken();
  if (storedToken && !isComposing()) {
    location.replace(localeHref("/admin"));
    return;
  }

  const form = document.getElementById("create-form");
  const errEl = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const resultCard = document.getElementById("result-card");
  const period = document.getElementById("period");
  const costHint = document.getElementById("cost-hint");
  const statusLine = document.getElementById("status-line");
  const syncStatus = document.getElementById("sync-status");
  const syncStatusMain = document.getElementById("sync-status-main");
  const reloadPreview = document.getElementById("reload-preview");
  const refreshBtn = document.getElementById("refresh-btn");
  const copyEmbedBtn = document.getElementById("copy-embed");
  const themeInput = document.getElementById("theme");
  const themeSegment = document.getElementById("theme-segment");
  const flowSteps = document.getElementById("flow-steps");
  const signedInBanner = document.getElementById("signed-in-banner");
  const tokenBlock = document.getElementById("token-block");
  const tokenRow = document.getElementById("token-row");

  let state = {
    id: null,
    publicId: null,
    adminToken: storedToken || null,
    feedUrl: null,
    pollTimer: null,
    pollStartTimer: null,
    theme: "site",
    widgetLimit: 5,
    title: "",
    borderless: false,
    showSummaries: true,
    reusedKey: Boolean(storedToken),
  };
  let previewBox = null;

  if (signedInBanner && state.adminToken) {
    signedInBanner.hidden = false;
  }
  const btnLogoutHome = document.getElementById("btn-logout-home");
  if (btnLogoutHome) {
    btnLogoutHome.addEventListener("click", function () {
      // Stop both poll handles (hoisted declaration) before dropping the key
      clearPollTimers();
      setComposing(false);
      clearToken();
      state.adminToken = null;
      state.reusedKey = false;
      if (signedInBanner) signedInBanner.hidden = true;
      location.href = localeHref("/");
    });
  }

  const APPEARANCE_DEFAULTS = {
    title: "",
    theme: "site",
    widgetLimit: 5,
    borderless: false,
    showSummaries: true,
  };

  const runsPerMonth = { "1h": 720, "6h": 120, "1d": 30, "7d": 4 };

  function setFlowStep(n) {
    if (!flowSteps) return;
    flowSteps.querySelectorAll(".step").forEach(function (el) {
      const s = Number(el.getAttribute("data-step"));
      el.classList.toggle("is-active", s === n);
      el.classList.toggle("is-done", s < n);
    });
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent.trim();
      btn.classList.add("is-busy");
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.innerHTML = "";
      const spin = document.createElement("span");
      spin.className = "btn-spinner";
      spin.setAttribute("aria-hidden", "true");
      btn.appendChild(spin);
      btn.appendChild(document.createTextNode(label || t("wait")));
    } else {
      btn.classList.remove("is-busy");
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = label || btn.dataset.idleLabel || btn.textContent;
      delete btn.dataset.idleLabel;
    }
  }

  async function withBusy(btn, busyLabel, fn) {
    setBusy(btn, true, busyLabel);
    try {
      return await fn();
    } finally {
      setBusy(btn, false);
    }
  }

  function flashOk(btn, okLabel, ms) {
    if (!btn) return;
    const prev = btn.dataset.idleLabel || btn.textContent;
    btn.classList.add("is-ok");
    btn.textContent = okLabel || t("done");
    setTimeout(function () {
      btn.classList.remove("is-ok");
      btn.textContent = prev;
    }, ms || 1400);
  }

  function setSyncStatus(text, kind) {
    const cls = "hint flash" + (kind ? " is-" + kind : "");
    if (syncStatus) {
      syncStatus.textContent = text || "";
      syncStatus.className = cls;
    }
    if (syncStatusMain) {
      if (text) {
        syncStatusMain.hidden = false;
        syncStatusMain.textContent = text;
        syncStatusMain.className = cls;
      } else {
        syncStatusMain.hidden = true;
        syncStatusMain.textContent = "";
      }
    }
  }

  function updateCost() {
    if (!period || !costHint) return;
    const p = period.value;
    const runs = runsPerMonth[p] || 30;
    costHint.textContent = t("cost_hint", { runs: runs });
  }

  if (period) {
    period.addEventListener("change", updateCost);
    updateCost();
  }

  document.addEventListener("wn:lang", function () {
    updateCost();
    document.querySelectorAll("button[data-i18n], .btn-link[data-i18n]").forEach(function (btn) {
      delete btn.dataset.idleLabel;
    });
  });

  function normalizeTheme(theme) {
    return theme === "light" || theme === "dark" ? theme : "site";
  }

  // Reflect a theme into the hidden input + segment active state (admin.js parity)
  function setThemeUI(theme) {
    const val = normalizeTheme(theme);
    if (themeInput) themeInput.value = val;
    if (themeSegment) {
      themeSegment.querySelectorAll("[data-theme]").forEach(function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-theme") === val);
      });
    }
  }
  setThemeUI(state.theme);

  // Theme segment control (site | light | dark)
  if (themeSegment && themeInput) {
    themeSegment.querySelectorAll("[data-theme]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const val = btn.getAttribute("data-theme");
        setThemeUI(val);
        state.theme = normalizeTheme(val);
        // Live preview: site inherits this page; light/dark are fixed palettes
        if (state.publicId) applyAppearanceLive();
      });
    });
  }

  const btnResetAppearance = document.getElementById("btn-reset-appearance");
  if (btnResetAppearance) {
    btnResetAppearance.addEventListener("click", function () {
      const titleEl = document.getElementById("title");
      const limitEl = document.getElementById("widgetLimit");
      const borderlessEl = document.getElementById("borderless");
      const summariesEl = document.getElementById("showSummaries");
      if (titleEl) titleEl.value = APPEARANCE_DEFAULTS.title;
      if (limitEl) limitEl.value = APPEARANCE_DEFAULTS.widgetLimit;
      if (themeInput) themeInput.value = APPEARANCE_DEFAULTS.theme;
      if (themeSegment) {
        themeSegment.querySelectorAll("[data-theme]").forEach(function (b) {
          b.classList.toggle("is-active", b.getAttribute("data-theme") === APPEARANCE_DEFAULTS.theme);
        });
      }
      if (borderlessEl) borderlessEl.checked = APPEARANCE_DEFAULTS.borderless;
      if (summariesEl) summariesEl.checked = APPEARANCE_DEFAULTS.showSummaries;
      state.theme = APPEARANCE_DEFAULTS.theme;
      state.widgetLimit = APPEARANCE_DEFAULTS.widgetLimit;
      state.title = APPEARANCE_DEFAULTS.title;
      state.borderless = APPEARANCE_DEFAULTS.borderless;
      state.showSummaries = APPEARANCE_DEFAULTS.showSummaries;
      if (state.publicId) applyAppearanceLive();
    });
  }

  // Example topic chips
  document.querySelectorAll(".chip[data-example]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const q = document.getElementById("query");
      if (!q) return;
      q.value = btn.getAttribute("data-example") || btn.textContent;
      q.focus();
    });
  });

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const id = btn.getAttribute("data-copy");
      const el = document.getElementById(id);
      if (!el) return;
      const ok = await withBusy(btn, t("btn_copying"), function () {
        return copyText(el.value);
      });
      if (ok) flashOk(btn, t("btn_copied"));
      else {
        el.focus();
        el.select && el.select();
        setSyncStatus(t("sync_copy_fail"), "err");
      }
    });
  });

  function ensureEmbed(cb) {
    if (window.WidgetNews || window.NwNews) {
      cb();
      return;
    }
    if (window.__embedLoading) {
      window.__embedLoading.push(cb);
      return;
    }
    window.__embedLoading = [cb];
    const s = document.createElement("script");
    s.src = "/embed.js";
    s.async = true;
    s.onload = function () {
      window.__embedLoaded = true;
      (window.__embedLoading || []).forEach(function (fn) {
        fn();
      });
      window.__embedLoading = null;
    };
    s.onerror = function () {
      window.__embedLoading = null;
      // A failed embed load must not strand the preview in its loading state.
      const host = document.getElementById("preview-host");
      if (host) host.classList.remove("is-loading");
      setSyncStatus(t("sync_embed_fail"), "err");
    };
    document.body.appendChild(s);
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/'/g, "&#39;");
  }

  function clientEmbedSnippet(publicId, app) {
    const parts = [
      'data-wn="' + escapeAttr(publicId) + '"',
      'data-theme="' + escapeAttr(normalizeTheme(app.theme)) + '"',
      'data-limit="' + escapeAttr(String(app.widgetLimit || 5)) + '"',
    ];
    if (app.title) parts.push('data-title="' + escapeAttr(app.title) + '"');
    if (app.borderless) parts.push('data-borderless="1"');
    if (app.showSummaries === false) parts.push('data-summaries="0"');
    return (
      "<div " +
      parts.join(" ") +
      "></div>\n" +
      '<script src="' +
      escapeAttr(location.origin + "/embed.js") +
      '" async></script>'
    );
  }

  function applyAppearanceLive() {
    if (!state.publicId) return;
    const app = readAppearance();
    state.theme = normalizeTheme(app.theme);
    state.widgetLimit = app.widgetLimit;
    state.title = app.title;
    state.borderless = app.borderless;
    state.showSummaries = app.showSummaries;
    const embedCodeEl = document.getElementById("embed-code");
    if (embedCodeEl) embedCodeEl.value = clientEmbedSnippet(state.publicId, app);
    mountPreview(state.publicId, app);
  }

  ["title", "widgetLimit", "borderless", "showSummaries"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", applyAppearanceLive);
  });

  function readAppearance() {
    return {
      title: (document.getElementById("title") && document.getElementById("title").value.trim()) || "",
      theme: (document.getElementById("theme") && document.getElementById("theme").value) || "site",
      widgetLimit: clampInt((document.getElementById("widgetLimit") || {}).value, 1, 50, 5),
      borderless: !!(document.getElementById("borderless") && document.getElementById("borderless").checked),
      showSummaries: !(
        document.getElementById("showSummaries") && !document.getElementById("showSummaries").checked
      ),
    };
  }

  function mountPreview(publicId, appearance) {
    appearance = appearance || readAppearance();
    const host = document.getElementById("preview-host");
    if (!host) return;
    host.classList.add("is-loading");
    host.innerHTML = "";
    previewBox = document.createElement("div");
    previewBox.setAttribute("data-wn", publicId);
    previewBox.setAttribute("data-theme", appearance.theme || "site");
    previewBox.setAttribute("data-limit", String(appearance.widgetLimit || 5));
    if (appearance.title) previewBox.setAttribute("data-title", appearance.title);
    if (appearance.borderless) previewBox.setAttribute("data-borderless", "1");
    if (appearance.showSummaries === false) previewBox.setAttribute("data-summaries", "0");
    previewBox.setAttribute("data-feed-base", location.origin);
    // Builder preview may need fresh feed after refresh — edge still caches production embeds
    previewBox.setAttribute("data-cache-bust", "1");
    previewBox.setAttribute("data-no-ping", "1");
    host.appendChild(previewBox);
    if (reloadPreview) reloadPreview.hidden = false;
    const box = previewBox;
    ensureEmbed(function () {
      const api = window.WidgetNews || window.NwNews;
      if (api && box) api.mount(box);
      setTimeout(function () {
        host.classList.remove("is-loading");
      }, 350);
    });
  }

  function refreshPreview() {
    if (!state.publicId) {
      setSyncStatus(t("sync_create_first"), "err");
      return;
    }
    const api = window.WidgetNews || window.NwNews;
    if (previewBox && api) {
      const host = document.getElementById("preview-host");
      if (!host) return;
      host.classList.add("is-loading");
      previewBox.setAttribute("data-cache-bust", "1");
      api.mount(previewBox);
      setTimeout(function () {
        host.classList.remove("is-loading");
      }, 400);
    } else {
      mountPreview(state.publicId, {
        title: state.title,
        theme: state.theme,
        widgetLimit: state.widgetLimit,
        borderless: state.borderless,
        showSummaries: state.showSummaries,
      });
    }
  }

  function requireWidget() {
    if (!state.id || !state.adminToken) {
      setSyncStatus(t("sync_need_widget"), "err");
      return false;
    }
    return true;
  }

  function persistState() {
    if (state.adminToken) saveToken(state.adminToken);
    try {
      sessionStorage.setItem(
        "wn_last_widget",
        JSON.stringify({
          id: state.id,
          publicId: state.publicId,
          feedUrl: state.feedUrl,
          theme: state.theme,
          widgetLimit: state.widgetLimit,
          title: state.title,
          borderless: state.borderless,
          showSummaries: state.showSummaries,
        }),
      );
    } catch (_) {}
  }

  // Always locale-aware /admin. Server adminUrl is origin-only (no /ru|/uk);
  // never emit a query string. Token, if present, stays in the fragment.
  function localizeAdminUrl(_serverUrl, token) {
    const url = location.origin + localeHref("/admin");
    return token ? url + "#token=" + encodeURIComponent(token) : url;
  }

  function updateTokenBlockUI(reused) {
    const titleEl = document.getElementById("token-block-title");
    const hintEl = document.getElementById("token-block-hint");
    if (reused) {
      if (titleEl) titleEl.textContent = t("label_token_linked");
      if (hintEl) hintEl.textContent = t("token_linked_hint");
      if (tokenRow) tokenRow.hidden = true;
    } else {
      if (titleEl) titleEl.textContent = t("label_admin_token");
      if (hintEl) hintEl.textContent = t("token_once");
      if (tokenRow) tokenRow.hidden = false;
    }
  }

  function applyWidgetResponse(data, opts) {
    opts = opts || {};
    const token = data.accessToken || data.adminToken || state.adminToken;
    // "reused" is a property of the current submit attempt only: the attempt's
    // existing key (opts.existingKey, "" for a fresh mint) came back unchanged.
    // The sticky state.reusedKey is reset here, never OR-ed in — a fresh or
    // rotated token must be shown once, never hidden by an earlier attempt.
    const reused = Boolean(opts.existingKey && token && token === opts.existingKey);
    if (token) {
      saveToken(token);
    }
    state = {
      id: data.id,
      publicId: data.publicId,
      adminToken: token,
      feedUrl: data.feedUrl,
      pollTimer: state.pollTimer,
      pollStartTimer: state.pollStartTimer,
      theme: data.theme || state.theme || "site",
      widgetLimit: data.widgetLimit || state.widgetLimit || 5,
      title: data.title || data.name || state.title || "",
      borderless: !!data.borderless,
      showSummaries: data.showSummaries !== false && data.showSummaries !== 0,
      reusedKey: reused,
    };
    if (token) {
      const adminTokenEl = document.getElementById("admin-token");
      if (adminTokenEl) adminTokenEl.value = token;
    }
    const adminUrl = localizeAdminUrl(data.adminUrl, token);
    const adminLinkEl = document.getElementById("admin-link");
    if (adminLinkEl) adminLinkEl.value = adminUrl;
    const openAdmin = document.getElementById("open-admin");
    if (openAdmin) {
      openAdmin.href = adminUrl;
      openAdmin.removeAttribute("data-lang-path"); // i18n rewrite would drop the fragment
    }
    const feedUrlEl = document.getElementById("feed-url");
    if (feedUrlEl) feedUrlEl.value = data.feedUrl || "";
    const embedCodeEl = document.getElementById("embed-code");
    if (embedCodeEl) embedCodeEl.value = data.embed || "";
    updateTokenBlockUI(reused);
    if (signedInBanner) signedInBanner.hidden = !token;
    if (resultCard) resultCard.hidden = false;
    setFlowStep(3);
    persistState();
    setThemeUI(state.theme);
    const openDemo = document.getElementById("open-demo");
    if (openDemo && state.publicId) {
      openDemo.href = localeHref("/demo") + "?id=" + encodeURIComponent(state.publicId);
      openDemo.removeAttribute("data-lang-path");
      openDemo.hidden = false;
    }
    if (opts.mount !== false) {
      mountPreview(state.publicId, {
        title: state.title,
        theme: state.theme,
        widgetLimit: state.widgetLimit,
        borderless: state.borderless,
        showSummaries: state.showSummaries,
      });
    }
    // After a successful create, drop ?new=1 so a language switch restores
    // this widget instead of a blank form; the compose flag keeps us here.
    if (forceNew) {
      try {
        history.replaceState({}, "", localeHref("/") + (location.hash || ""));
      } catch (_) {}
    }
  }

  // Both poll handles live in state: the pending 2s start delay and the live
  // interval. Clearing both keeps a duplicate pollSync from orphaning either
  // one or letting a stale callback overwrite the current interval handle.
  function clearPollTimers() {
    if (state.pollStartTimer) {
      clearTimeout(state.pollStartTimer);
      state.pollStartTimer = null;
    }
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function pollSync(maxAttempts) {
    let n = 0;
    clearPollTimers();
    setSyncStatus(t("sync_searching"));
    if (statusLine) {
      statusLine.textContent = t("status_created");
      statusLine.className = "ok";
    }

    const tick = async function () {
      n++;
      try {
        const res = await fetch("/api/widgets/" + encodeURIComponent(state.id), {
          headers: { authorization: "Bearer " + state.adminToken },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);

        if (data.lastSyncedAt) {
          const when = new Date(data.lastSyncedAt).toLocaleString();
          setSyncStatus(t("sync_ready", { when: when }), "ok");
          if (statusLine) {
            statusLine.textContent = t("status_ready");
            statusLine.className = "ok";
          }
          refreshPreview();
          clearPollTimers();
          return;
        }
        setSyncStatus(t("sync_waiting", { n: n, max: maxAttempts }));
        refreshPreview();
      } catch (e) {
        setSyncStatus(t("sync_status_err", { msg: e.message || e }), "err");
      }
      if (n >= maxAttempts) {
        clearPollTimers();
        setSyncStatus(t("sync_timeout"), "err");
        const more = document.querySelector("#result-card details.result-more");
        if (more) more.open = true;
      }
    };

    state.pollStartTimer = setTimeout(function () {
      state.pollStartTimer = null;
      // Handle first, immediate tick second: a first tick that is already
      // synced clears a real timer — never an orphan interval.
      state.pollTimer = setInterval(tick, 3000);
      tick();
    }, 2000);
  }

  // Blank-safe finite integer clamp (mirror of admin.js/backend clampInt):
  // empty or non-numeric input falls back instead of coercing to 0 or NaN.
  function clampInt(value, min, max, fallback) {
    const trimmed = String(value === null || value === undefined ? "" : value).trim();
    if (!trimmed) return fallback;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (errEl) errEl.hidden = true;
    setFlowStep(2);
    await withBusy(submitBtn, t("btn_creating"), async function () {
      try {
        const appearance = readAppearance();
        const existingKey = getStoredToken() || state.adminToken || "";
        const body = {
          title: appearance.title || undefined,
          query: document.getElementById("query").value.trim(),
          period: document.getElementById("period").value,
          numResults: clampInt(document.getElementById("numResults").value, 1, 20, 10),
          widgetLimit: appearance.widgetLimit,
          theme: appearance.theme,
          borderless: appearance.borderless,
          showSummaries: appearance.showSummaries,
        };
        // Reuse stored client key — no new token for returning publishers
        if (existingKey) {
          body.accessToken = existingKey;
        }
        const res = await fetch("/api/widgets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);

        // The one-time token row shows only when this attempt minted (or
        // rotated to) a new key — an echoed existingKey hides it.
        applyWidgetResponse(data, { mount: true, existingKey: existingKey });
        if (resultCard) resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setSyncStatus(t("sync_searching"));
        pollSync(12);
      } catch (err) {
        setFlowStep(1);
        if (errEl) {
          errEl.textContent = err.message || String(err);
          errEl.hidden = false;
        }
      }
    });
  });

  if (copyEmbedBtn) {
    copyEmbedBtn.addEventListener("click", async function () {
      const ta = document.getElementById("embed-code");
      if (!ta) return;
      const ok = await withBusy(copyEmbedBtn, t("btn_copying"), function () {
        return copyText(ta.value);
      });
      if (ok) flashOk(copyEmbedBtn, t("btn_copied"));
      else {
        ta.focus();
        ta.select();
        setSyncStatus(t("sync_copy_fail"), "err");
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async function () {
      if (!requireWidget()) return;
      await withBusy(refreshBtn, t("wait"), async function () {
        try {
          setSyncStatus(t("sync_searching"));
          const res = await fetch(
            "/api/widgets/" + encodeURIComponent(state.id) + "/refresh",
            {
              method: "POST",
              headers: { authorization: "Bearer " + state.adminToken },
            },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          const ok = data.refreshed || data.synced;
          if (ok) {
            setSyncStatus(t("refresh_ok_n", { n: data.itemCount || 0 }), "ok");
            refreshPreview();
          } else {
            setSyncStatus(t("refresh_fail", { reason: data.reason || "failed" }), "err");
          }
        } catch (err) {
          setSyncStatus(err.message || String(err), "err");
        }
      });
    });
  }

  if (reloadPreview) reloadPreview.addEventListener("click", async function () {
    if (!state.publicId) {
      setSyncStatus(t("sync_create_first"), "err");
      return;
    }
    await withBusy(reloadPreview, t("wait"), async function () {
      refreshPreview();
      await new Promise(function (r) {
        setTimeout(r, 450);
      });
      setSyncStatus(t("sync_preview_ok"), "ok");
    });
  });

  // After create, session may still have last widget for preview (token is in WN_AUTH storage)
  try {
    const raw =
      sessionStorage.getItem("wn_last_widget") || sessionStorage.getItem("nw_last_widget");
    if (raw && forceNew) {
      /* stay on clean form for new widget */
    } else if (raw) {
      let saved = null;
      try {
        saved = JSON.parse(raw);
      } catch (_) {}
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const tok = getStoredToken() || saved.token;
        if (saved.publicId && tok) {
          state = {
            id: saved.id,
            publicId: saved.publicId,
            adminToken: tok,
            feedUrl: saved.feedUrl || null,
            pollTimer: null,
            pollStartTimer: null,
            theme: saved.theme || "site",
            widgetLimit: saved.widgetLimit || 5,
            title: saved.title || "",
            borderless: !!saved.borderless,
            showSummaries: saved.showSummaries !== false,
            reusedKey: true,
          };
          saveToken(tok);
          const adminTokenEl = document.getElementById("admin-token");
          if (adminTokenEl) adminTokenEl.value = tok;
          // Restored same-browser session: clean dashboard link — key stays in WN_AUTH storage
          const adminLink = localizeAdminUrl(null, null);
          const adminLinkEl = document.getElementById("admin-link");
          if (adminLinkEl) adminLinkEl.value = adminLink;
          const openAdmin = document.getElementById("open-admin");
          if (openAdmin) {
            openAdmin.href = adminLink;
            openAdmin.removeAttribute("data-lang-path");
          }
          const feedUrlEl = document.getElementById("feed-url");
          if (saved.feedUrl && feedUrlEl) feedUrlEl.value = saved.feedUrl;
          updateTokenBlockUI(true);
          if (signedInBanner) signedInBanner.hidden = false;
          if (resultCard) resultCard.hidden = false;
          setFlowStep(3);
          if (statusLine) {
            statusLine.textContent = t("status_ready");
            statusLine.className = "ok";
          }
          setThemeUI(state.theme);
          const openDemoRestore = document.getElementById("open-demo");
          if (openDemoRestore && state.publicId) {
            openDemoRestore.href = localeHref("/demo") + "?id=" + encodeURIComponent(state.publicId);
            openDemoRestore.removeAttribute("data-lang-path");
            openDemoRestore.hidden = false;
          }
          mountPreview(state.publicId, {
            title: state.title,
            theme: state.theme,
            widgetLimit: state.widgetLimit,
            borderless: state.borderless,
            showSummaries: state.showSummaries,
          });
          fetch("/api/widgets/" + encodeURIComponent(saved.id || saved.publicId), {
            headers: { authorization: "Bearer " + tok },
          })
            .then(function (r) {
              return r.json().then(function (d) {
                return { ok: r.ok, d: d };
              });
            })
            .then(function (x) {
              if (!x.ok || !x.d) return;
              if (x.d.feedUrl && feedUrlEl) feedUrlEl.value = x.d.feedUrl;
              const embedCodeEl = document.getElementById("embed-code");
              if (x.d.embed && embedCodeEl) embedCodeEl.value = x.d.embed;
              if (openAdmin) {
                openAdmin.href = localizeAdminUrl(null, null);
                openAdmin.removeAttribute("data-lang-path");
              }
              state.theme = x.d.theme || state.theme;
              state.widgetLimit = x.d.widgetLimit || state.widgetLimit;
              state.title = x.d.title || x.d.name || state.title;
              state.borderless = !!x.d.borderless;
              state.showSummaries = x.d.showSummaries !== false && x.d.showSummaries !== 0;
              state.id = x.d.id || state.id;
              persistState();
            })
            .catch(function () {});
        }
      }
    }
  } catch (_) {}
})();
