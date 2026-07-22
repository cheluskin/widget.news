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
    if (auth() && token) auth().setAccessToken(token);
  }
  function clearToken() {
    if (auth()) auth().clearAccessToken();
  }

  // Logged-in users land in dashboard — stay on builder only with ?new=1
  var params = new URLSearchParams(location.search);
  var forceNew = params.get("new") === "1" || params.get("new") === "true";
  var storedToken = getStoredToken();
  if (storedToken && !forceNew) {
    location.replace(localeHref("/admin"));
    return;
  }
  if (forceNew) {
    history.replaceState({}, "", localeHref("/") + (location.hash || ""));
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
  var btnLogoutHome = document.getElementById("btn-logout-home");
  if (btnLogoutHome) {
    btnLogoutHome.addEventListener("click", function () {
      clearToken();
      state.adminToken = null;
      state.reusedKey = false;
      if (signedInBanner) signedInBanner.hidden = true;
      location.href = localeHref("/");
    });
  }

  var APPEARANCE_DEFAULTS = {
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
      var s = Number(el.getAttribute("data-step"));
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
    var cls = "hint flash" + (kind ? " is-" + kind : "");
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

  // Theme segment control (site | light | dark)
  if (themeSegment && themeInput) {
    themeSegment.querySelectorAll("[data-theme]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var val = btn.getAttribute("data-theme");
        themeInput.value = val;
        themeSegment.querySelectorAll("[data-theme]").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        // Live preview: site inherits this page; light/dark are fixed palettes
        if (state.publicId) {
          state.theme = val;
          var app = readAppearance();
          app.theme = val;
          mountPreview(state.publicId, app);
        }
      });
    });
  }

  var btnResetAppearance = document.getElementById("btn-reset-appearance");
  if (btnResetAppearance) {
    btnResetAppearance.addEventListener("click", function () {
      var titleEl = document.getElementById("title");
      var limitEl = document.getElementById("widgetLimit");
      var borderlessEl = document.getElementById("borderless");
      var summariesEl = document.getElementById("showSummaries");
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
      if (state.publicId) mountPreview(state.publicId, APPEARANCE_DEFAULTS);
    });
  }

  // Example topic chips
  document.querySelectorAll(".chip[data-example]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var q = document.getElementById("query");
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
      setSyncStatus(t("sync_embed_fail"), "err");
    };
    document.body.appendChild(s);
  }

  function readAppearance() {
    return {
      title: (document.getElementById("title") && document.getElementById("title").value.trim()) || "",
      theme: (document.getElementById("theme") && document.getElementById("theme").value) || "site",
      widgetLimit: Number((document.getElementById("widgetLimit") || {}).value) || 5,
      borderless: !!(document.getElementById("borderless") && document.getElementById("borderless").checked),
      showSummaries: !(
        document.getElementById("showSummaries") && !document.getElementById("showSummaries").checked
      ),
    };
  }

  function mountPreview(publicId, appearance) {
    appearance = appearance || readAppearance();
    const host = document.getElementById("preview-host");
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
    reloadPreview.hidden = false;
    ensureEmbed(function () {
      var api = window.WidgetNews || window.NwNews;
      if (api) api.mount(previewBox);
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
    var api = window.WidgetNews || window.NwNews;
    if (previewBox && api) {
      const host = document.getElementById("preview-host");
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

  function localizeAdminUrl(serverUrl, publicId, token) {
    // Token lives in localStorage — dashboard link does not need ?token=
    var path = localeHref("/admin");
    return location.origin + path;
  }

  function updateTokenBlockUI(reused) {
    var titleEl = document.getElementById("token-block-title");
    var hintEl = document.getElementById("token-block-hint");
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
    var token = data.accessToken || data.adminToken || state.adminToken;
    var reused = state.reusedKey || Boolean(getStoredToken() && token === getStoredToken());
    if (token) {
      saveToken(token);
      reused = reused || state.reusedKey;
    }
    state = {
      id: data.id,
      publicId: data.publicId,
      adminToken: token,
      feedUrl: data.feedUrl,
      pollTimer: state.pollTimer,
      theme: data.theme || state.theme || "site",
      widgetLimit: data.widgetLimit || state.widgetLimit || 5,
      title: data.title || data.name || state.title || "",
      borderless: !!data.borderless,
      showSummaries: data.showSummaries !== false && data.showSummaries !== 0,
      reusedKey: reused,
    };
    if (token) {
      document.getElementById("admin-token").value = token;
    }
    var adminUrl = localizeAdminUrl(data.adminUrl, data.publicId, token);
    document.getElementById("admin-link").value = adminUrl;
    document.getElementById("open-admin").href = adminUrl;
    document.getElementById("feed-url").value = data.feedUrl || "";
    document.getElementById("embed-code").value = data.embed || "";
    updateTokenBlockUI(reused);
    if (signedInBanner) signedInBanner.hidden = !token;
    resultCard.hidden = false;
    setFlowStep(3);
    persistState();
    if (opts.mount !== false) {
      mountPreview(state.publicId, {
        title: state.title,
        theme: state.theme,
        widgetLimit: state.widgetLimit,
        borderless: state.borderless,
        showSummaries: state.showSummaries,
      });
    }
  }

  async function pollSync(maxAttempts) {
    let n = 0;
    if (state.pollTimer) clearInterval(state.pollTimer);
    setSyncStatus(t("sync_searching"));
    statusLine.textContent = t("status_created");
    statusLine.className = "ok";

    const tick = async function () {
      n++;
      try {
        const res = await fetch(
          "/api/widgets/" +
            encodeURIComponent(state.id) +
            "?token=" +
            encodeURIComponent(state.adminToken),
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);

        if (data.lastSyncedAt) {
          var when = new Date(data.lastSyncedAt).toLocaleString();
          setSyncStatus(t("sync_ready", { when: when }), "ok");
          statusLine.textContent = t("status_ready");
          statusLine.className = "ok";
          refreshPreview();
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          return;
        }
        setSyncStatus(t("sync_waiting", { n: n, max: maxAttempts }));
        refreshPreview();
      } catch (e) {
        setSyncStatus(t("sync_status_err", { msg: e.message || e }), "err");
      }
      if (n >= maxAttempts) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        setSyncStatus(t("sync_timeout"), "err");
      }
    };

    setTimeout(function () {
      tick();
      state.pollTimer = setInterval(tick, 3000);
    }, 2000);
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errEl.hidden = true;
    setFlowStep(2);
    await withBusy(submitBtn, t("btn_creating"), async function () {
      try {
        const appearance = readAppearance();
        const existingKey = getStoredToken() || state.adminToken || "";
        const body = {
          title: appearance.title || undefined,
          query: document.getElementById("query").value.trim(),
          period: document.getElementById("period").value,
          numResults: Number(document.getElementById("numResults").value),
          widgetLimit: appearance.widgetLimit,
          theme: appearance.theme,
          borderless: appearance.borderless,
          showSummaries: appearance.showSummaries,
        };
        // Reuse permanent client key — no new token for returning publishers
        if (existingKey) {
          body.accessToken = existingKey;
          state.reusedKey = true;
        }
        const res = await fetch("/api/widgets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);

        applyWidgetResponse(data, { mount: true });
        resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setSyncStatus(t("sync_searching"));
        pollSync(12);
      } catch (err) {
        setFlowStep(1);
        errEl.textContent = err.message || String(err);
        errEl.hidden = false;
      }
    });
  });

  copyEmbedBtn.addEventListener("click", async function () {
    const ta = document.getElementById("embed-code");
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

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async function () {
      if (!requireWidget()) return;
      await withBusy(refreshBtn, t("wait"), async function () {
        try {
          setSyncStatus(t("sync_searching"));
          const res = await fetch("/api/widgets/" + state.id + "/refresh", {
            method: "POST",
            headers: { authorization: "Bearer " + state.adminToken },
          });
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

  reloadPreview.addEventListener("click", async function () {
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

  // After create, session may still have last widget for preview (token is in localStorage)
  try {
    const raw =
      sessionStorage.getItem("wn_last_widget") || sessionStorage.getItem("nw_last_widget");
    if (raw && forceNew) {
      /* stay on clean form for new widget */
    } else if (raw) {
      const saved = JSON.parse(raw);
      var tok = getStoredToken() || saved.token;
      if (saved && saved.publicId && tok) {
        state = {
          id: saved.id,
          publicId: saved.publicId,
          adminToken: tok,
          feedUrl: saved.feedUrl || null,
          pollTimer: null,
          theme: saved.theme || "site",
          widgetLimit: saved.widgetLimit || 5,
          title: saved.title || "",
          borderless: !!saved.borderless,
          showSummaries: saved.showSummaries !== false,
          reusedKey: true,
        };
        saveToken(tok);
        document.getElementById("admin-token").value = tok;
        document.getElementById("admin-link").value = localizeAdminUrl(null, saved.publicId, tok);
        document.getElementById("open-admin").href = document.getElementById("admin-link").value;
        if (saved.feedUrl) document.getElementById("feed-url").value = saved.feedUrl;
        updateTokenBlockUI(true);
        if (signedInBanner) signedInBanner.hidden = false;
        resultCard.hidden = false;
        setFlowStep(3);
        statusLine.textContent = t("status_ready");
        statusLine.className = "ok";
        mountPreview(state.publicId, {
          title: state.title,
          theme: state.theme,
          widgetLimit: state.widgetLimit,
          borderless: state.borderless,
          showSummaries: state.showSummaries,
        });
        fetch(
          "/api/widgets/" + encodeURIComponent(saved.publicId) + "?token=" + encodeURIComponent(tok),
        )
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (x) {
            if (!x.ok) return;
            if (x.d.feedUrl) document.getElementById("feed-url").value = x.d.feedUrl;
            if (x.d.embed) document.getElementById("embed-code").value = x.d.embed;
            document.getElementById("open-admin").href = localizeAdminUrl(null, x.d.publicId, tok);
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
  } catch (_) {}
})();
