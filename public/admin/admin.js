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
  function saveToken(token, scope) {
    if (auth() && token) auth().setAccessToken(token, scope);
  }
  function clearToken() {
    if (auth()) auth().clearAccessToken();
  }

  const APPEARANCE_DEFAULTS = {
    title: "",
    theme: "site",
    widgetLimit: 5,
    borderless: false,
    showSummaries: true,
  };

  const loadForm = document.getElementById("load-form");
  const loadCard = document.getElementById("load-card");
  const listCard = document.getElementById("list-card");
  const manage = document.getElementById("manage-card");
  const widgetList = document.getElementById("widget-list");
  const loadErr = document.getElementById("load-error");
  const editErr = document.getElementById("edit-error");
  const editOk = document.getElementById("edit-ok");
  const loadBtn = loadForm ? loadForm.querySelector('button[type="submit"]') : null;
  const saveBtn = document.querySelector('#edit-form button[type="submit"]');
  const btnRefresh = document.getElementById("btn-refresh");
  const btnDelete = document.getElementById("btn-delete");
  const btnLogout = document.getElementById("btn-logout");
  const btnLogoutManage = document.getElementById("btn-logout-manage");
  const btnBackList = document.getElementById("btn-back-list");
  const btnResetAppearance = document.getElementById("btn-reset-appearance");
  const themeInput = document.getElementById("edit-theme");
  const themeSegment = document.getElementById("edit-theme-segment");

  let state = { publicId: null, token: null, widgets: [], scope: null };

  // Prefill from stored credentials — auth.js already staged any `#token=`
  // deep link (session scope) and scrubbed it from the URL
  if (getStoredToken()) {
    document.getElementById("token").value = getStoredToken();
  }

  function setNewWidgetLinks() {
    const href = localeHref("/") + "?new=1";
    document.querySelectorAll("#btn-new-widget, #btn-new-widget-manage").forEach(function (a) {
      a.setAttribute("href", href);
      a.removeAttribute("data-lang-path"); // absolute with query
    });
  }
  setNewWidgetLinks();
  document.addEventListener("wn:lang", setNewWidgetLinks);

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
      const val = el.value != null ? el.value : el.textContent;
      const ok = await withBusy(btn, t("btn_copying"), function () {
        return copyText(val);
      });
      if (ok) flashOk(btn, t("btn_copied"));
    });
  });

  function normalizeTheme(theme) {
    if (theme === "light" || theme === "dark") return theme;
    return "site";
  }

  function setThemeUI(theme) {
    const val = normalizeTheme(theme);
    if (themeInput) themeInput.value = val;
    if (!themeSegment) return;
    themeSegment.querySelectorAll("[data-theme]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-theme") === val);
    });
  }

  function authHeaders() {
    return { authorization: "Bearer " + state.token, "content-type": "application/json" };
  }

  // Read an API response exactly once, parsing JSON only for a non-empty body,
  // so HTML/plain-text edge errors surface as a clear message instead of a
  // masked JSON parse failure. A successful empty body is a neutral object;
  // non-OK empty/non-JSON bodies throw a clear status fallback; the thrown
  // error also carries the HTTP status for auth-rejection detection.
  async function readApiResponse(res) {
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || "HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    if (!text) return {};
    if (!data) throw new Error("Unexpected response from server");
    return data;
  }

  function showOk(msg) {
    if (editOk) {
      editOk.textContent = msg;
      editOk.hidden = false;
    }
    if (editErr) editErr.hidden = true;
  }

  function showErr(msg) {
    if (editErr) {
      editErr.textContent = msg;
      editErr.hidden = false;
    }
    if (editOk) editOk.hidden = true;
  }

  function ensureEmbed(cb) {
    if (window.WidgetNews || window.NwNews) return cb();
    const s = document.createElement("script");
    s.src = "/embed.js";
    s.onload = cb;
    s.onerror = function () {
      // A failed embed load must not strand the preview in its loading state.
      const host = document.getElementById("preview");
      if (host) host.classList.remove("is-loading");
      showErr(t("sync_embed_fail"));
    };
    document.body.appendChild(s);
  }

  // Mirror of the backend clampInt: only finite numbers and non-empty finite
  // numeric strings are accepted; everything else falls back (never coerced,
  // so blank input preserves the current value instead of sending null/min).
  function clampInt(value, min, max, fallback) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return fallback;
      return Math.min(max, Math.max(min, Math.round(value)));
    }
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function currentWidget() {
    return (
      state.widgets.find(function (w) {
        return w.publicId === state.publicId;
      }) || null
    );
  }

  function currentNumResults() {
    const w = currentWidget();
    return w ? clampInt(w.numResults, 1, 20, 10) : 10;
  }

  function currentWidgetLimit() {
    const w = currentWidget();
    return w ? clampInt(w.widgetLimit, 1, 50, 5) : 5;
  }

  function readAppearanceFromForm() {
    return {
      title: document.getElementById("edit-title").value.trim(),
      theme: normalizeTheme(document.getElementById("edit-theme").value),
      widgetLimit: clampInt(document.getElementById("edit-limit").value, 1, 50, currentWidgetLimit()),
      borderless: document.getElementById("edit-borderless").checked,
      showSummaries: document.getElementById("edit-summaries").checked,
    };
  }

  function showPreview(publicId, appearance) {
    const host = document.getElementById("preview");
    if (!host) return;
    host.classList.add("is-loading");
    host.innerHTML = "";
    const box = document.createElement("div");
    box.setAttribute("data-wn", publicId);
    box.setAttribute("data-theme", normalizeTheme(appearance.theme));
    box.setAttribute("data-limit", String(appearance.widgetLimit || 5));
    if (appearance.title) box.setAttribute("data-title", appearance.title);
    if (appearance.borderless) box.setAttribute("data-borderless", "1");
    if (appearance.showSummaries === false) box.setAttribute("data-summaries", "0");
    box.setAttribute("data-feed-base", location.origin);
    box.setAttribute("data-cache-bust", "1");
    box.setAttribute("data-no-ping", "1");
    host.appendChild(box);
    ensureEmbed(function () {
      const api = window.WidgetNews || window.NwNews;
      if (api) api.mount(box);
      setTimeout(function () {
        host.classList.remove("is-loading");
      }, 350);
    });
  }

  function livePreview() {
    if (!state.publicId) return;
    showPreview(state.publicId, readAppearanceFromForm());
  }

  if (themeSegment && themeInput) {
    themeSegment.querySelectorAll("[data-theme]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setThemeUI(btn.getAttribute("data-theme"));
        livePreview();
      });
    });
  }

  ["edit-title", "edit-limit", "edit-borderless", "edit-summaries"].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", livePreview);
    if (el.tagName === "INPUT" && el.type === "text") {
      el.addEventListener("input", function () {
        clearTimeout(el._previewTimer);
        el._previewTimer = setTimeout(livePreview, 280);
      });
    }
  });

  function statusLabel(status) {
    if (status === "paused") return t("status_paused");
    if (status === "active") return t("status_active");
    if (status === "inactive") return t("status_inactive");
    return status || "—";
  }

  function statusClass(status) {
    if (status === "paused") return "is-paused";
    if (status === "inactive") return "is-inactive";
    return "is-active";
  }

  function widgetLabel(data) {
    return (data.title || data.name || data.query || t("widget_default")).slice(0, 80);
  }

  function fill(data) {
    state.publicId = data.publicId;
    document.getElementById("widget-title").textContent = widgetLabel(data);
    const when = data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : "—";
    const seen = data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString() : "—";
    document.getElementById("meta-line").textContent = t("admin_meta_line", {
      status: statusLabel(data.status),
      when: when,
      period: data.period || "—",
      seen: seen,
    });
    document.getElementById("edit-title").value = data.title || data.name || "";
    document.getElementById("edit-query").value = data.query;
    document.getElementById("edit-period").value = data.period;
    document.getElementById("edit-num").value = data.numResults;
    document.getElementById("edit-limit").value = data.widgetLimit;
    setThemeUI(data.theme);
    document.getElementById("edit-borderless").checked = !!data.borderless;
    document.getElementById("edit-summaries").checked =
      data.showSummaries !== false && data.showSummaries !== 0;
    // inactive is system-only — map select to active for editing
    const st = data.status === "paused" ? "paused" : "active";
    document.getElementById("edit-status").value = st;
    document.getElementById("embed-out").value = data.embed;
    document.getElementById("feed-out").value = data.feedUrl;
    if (manage) manage.hidden = false;
    if (loadCard) loadCard.hidden = true;
    if (listCard) listCard.hidden = state.widgets.length <= 1;
    if (btnBackList) btnBackList.hidden = state.widgets.length <= 1;
    showPreview(data.publicId, {
      title: data.title || data.name || "",
      theme: data.theme,
      widgetLimit: data.widgetLimit,
      borderless: !!data.borderless,
      showSummaries: data.showSummaries !== false && data.showSummaries !== 0,
    });
  }

  function renderList(widgets) {
    if (!widgetList) return;
    widgetList.innerHTML = "";
    widgets.forEach(function (w) {
      const li = document.createElement("li");
      li.className = "widget-list-item";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "widget-list-btn";
      btn.innerHTML =
        '<span class="widget-list-title"></span>' +
        '<span class="widget-list-meta"></span>' +
        '<span class="status-pill"></span>';
      btn.querySelector(".widget-list-title").textContent = widgetLabel(w);
      const when = w.lastSyncedAt ? new Date(w.lastSyncedAt).toLocaleDateString() : "—";
      btn.querySelector(".widget-list-meta").textContent = t("admin_list_meta", {
        when: when,
        period: w.period || "—",
      });
      const pill = btn.querySelector(".status-pill");
      pill.textContent = statusLabel(w.status);
      pill.className = "status-pill " + statusClass(w.status);
      btn.addEventListener("click", function () {
        fill(w);
        if (listCard) listCard.hidden = true;
      });
      li.appendChild(btn);
      widgetList.appendChild(li);
    });
  }

  async function loadWidgets() {
    if (loadErr) loadErr.hidden = true;
    const token = document.getElementById("token").value.trim();
    if (!token) throw new Error(t("admin_no_widgets"));
    state.token = token;
    const res = await fetch("/api/widgets", {
      headers: { authorization: "Bearer " + token },
    });
    const data = await readApiResponse(res);
    const widgets = data.widgets || (data.publicId ? [data] : []);
    if (!widgets.length) throw new Error(t("admin_no_widgets"));
    // Only an exact server-confirmed "client" scope is eligible for finite
    // localStorage persistence; root, missing, or unknown stays session-only
    // (WN_AUTH purges any persistent key for non-client scopes).
    if (data.scope === "client") state.scope = "client";
    else if (data.scope === "root") state.scope = "root";
    else state.scope = "unknown";
    saveToken(token, state.scope);
    state.widgets = widgets;
    if (loadCard) loadCard.hidden = true;
    // Always show list when multiple; single non-root can open editor directly
    if (widgets.length === 1 && state.scope !== "root") {
      if (listCard) listCard.hidden = true;
      fill(widgets[0]);
    } else {
      if (manage) manage.hidden = true;
      if (listCard) {
        listCard.hidden = false;
        renderList(widgets);
      }
    }
  }

  function doLogout() {
    clearToken();
    state = { publicId: null, token: null, widgets: [], scope: null };
    if (manage) manage.hidden = true;
    if (listCard) listCard.hidden = true;
    if (loadCard) loadCard.hidden = false;
    const tokenInput = document.getElementById("token");
    if (tokenInput) tokenInput.value = "";
    if (loadErr) loadErr.hidden = true;
  }

  // Single shared in-flight login: calls never run concurrently. A login
  // requested while one is in flight (e.g. a manual submit during auto-login)
  // is never discarded — it is queued to run once the current flight settles,
  // success or failure, under its own busy state so its token is validated.
  // The handle clears on settle only when nothing newer was queued, so a
  // submit can retry after any failure.
  let loginFlight = null;
  function requestLogin(run) {
    if (loginFlight) {
      let queued = loginFlight.catch(function () {}).then(function () {
        if (loginFlight === queued) loginFlight = null;
        return requestLogin(run);
      });
      loginFlight = queued;
      return queued;
    }
    let tracked = withBusy(loadBtn, t("btn_loading"), run);
    tracked = tracked.finally(function () {
      if (loginFlight === tracked) loginFlight = null;
    });
    loginFlight = tracked;
    return tracked;
  }

  if (loadForm) {
    loadForm.addEventListener("submit", function (e) {
      e.preventDefault();
      requestLogin(async function () {
        try {
          await loadWidgets();
          showOk(t("loaded_ok"));
        } catch (err) {
          if (loadErr) {
            loadErr.textContent = err.message || String(err);
            loadErr.hidden = false;
          }
        }
      });
    });
  }

  // Auto-login from stored credentials (persistent client key or staged token)
  if (getStoredToken()) {
    requestLogin(async function () {
      try {
        await loadWidgets();
      } catch (err) {
        // Only a server-confirmed auth rejection proves the stored key bad —
        // transient network/5xx failures keep it for the next visit.
        if ((err.status === 401 || err.status === 403) && getStoredToken()) {
          clearToken();
          document.getElementById("token").value = "";
        }
        if (loadErr) {
          loadErr.textContent = err.message || String(err);
          loadErr.hidden = false;
        }
      }
    });
  }

  if (btnLogout) btnLogout.addEventListener("click", doLogout);
  if (btnLogoutManage) btnLogoutManage.addEventListener("click", doLogout);

  if (btnBackList) {
    btnBackList.addEventListener("click", function () {
      if (manage) manage.hidden = true;
      if (listCard) {
        listCard.hidden = false;
        renderList(state.widgets);
      }
      state.publicId = null;
    });
  }

  if (btnResetAppearance) {
    btnResetAppearance.addEventListener("click", function () {
      document.getElementById("edit-title").value = APPEARANCE_DEFAULTS.title;
      document.getElementById("edit-limit").value = APPEARANCE_DEFAULTS.widgetLimit;
      setThemeUI(APPEARANCE_DEFAULTS.theme);
      document.getElementById("edit-borderless").checked = APPEARANCE_DEFAULTS.borderless;
      document.getElementById("edit-summaries").checked = APPEARANCE_DEFAULTS.showSummaries;
      livePreview();
      showOk(t("reset_appearance_ok"));
    });
  }

  const editForm = document.getElementById("edit-form");
  if (editForm) {
    editForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (editErr) editErr.hidden = true;
      if (editOk) editOk.hidden = true;
      if (!state.publicId || !state.token) {
        showErr(t("load_first"));
        return;
      }
      await withBusy(saveBtn, t("btn_saving"), async function () {
        try {
          const appearance = readAppearanceFromForm();
          const body = {
            title: appearance.title,
            query: document.getElementById("edit-query").value.trim(),
            period: document.getElementById("edit-period").value,
            numResults: clampInt(document.getElementById("edit-num").value, 1, 20, currentNumResults()),
            widgetLimit: appearance.widgetLimit,
            theme: appearance.theme,
            borderless: appearance.borderless,
            showSummaries: appearance.showSummaries,
            status: document.getElementById("edit-status").value,
          };
          const res = await fetch("/api/widgets/" + encodeURIComponent(state.publicId), {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify(body),
          });
          const data = await readApiResponse(res);
          // An empty successful body is a neutral {} — keep the loaded widget
          // and UI state untouched and just report success. Only a response
          // echoing the loaded publicId is merged into the list cache.
          if (data && data.publicId && data.publicId === state.publicId) {
            // refresh list cache entry
            state.widgets = state.widgets.map(function (w) {
              return w.publicId === data.publicId ? data : w;
            });
            fill(data);
          }
          showOk(t("saved_ok"));
        } catch (err) {
          showErr(err.message || String(err));
        }
      });
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener("click", async function () {
      if (!state.publicId || !state.token) {
        showErr(t("load_first"));
        return;
      }
      await withBusy(btnRefresh, t("wait"), async function () {
        try {
          const res = await fetch("/api/widgets/" + encodeURIComponent(state.publicId) + "/refresh", {
            method: "POST",
            headers: authHeaders(),
          });
          const data = await readApiResponse(res);
          const ok = data.refreshed || data.synced;
          showOk(
            ok
              ? t("refresh_ok_n", { n: data.itemCount || 0 })
              : t("refresh_fail", { reason: data.reason || "failed" }),
          );
          livePreview();
        } catch (err) {
          showErr(err.message || String(err));
        }
      });
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener("click", async function () {
      if (!state.publicId || !state.token) {
        showErr(t("load_first"));
        return;
      }
      if (!confirm(t("confirm_delete"))) return;
      await withBusy(btnDelete, t("btn_deleting"), async function () {
        try {
          const res = await fetch("/api/widgets/" + encodeURIComponent(state.publicId), {
            method: "DELETE",
            headers: authHeaders(),
          });
          const data = await readApiResponse(res);
          state.widgets = state.widgets.filter(function (w) {
            return w.publicId !== state.publicId;
          });
          state.publicId = null;
          if (manage) manage.hidden = true;
          if (state.widgets.length === 0) {
            if (listCard) listCard.hidden = true;
            if (loadCard) loadCard.hidden = false;
            clearToken();
            state.token = null;
            state.scope = null;
            const tokenInput = document.getElementById("token");
            if (tokenInput) tokenInput.value = "";
          } else if (listCard) {
            listCard.hidden = false;
            renderList(state.widgets);
          }
          alert(t("deleted_ok"));
        } catch (err) {
          showErr(err.message || String(err));
        }
      });
    });
  }
})();
