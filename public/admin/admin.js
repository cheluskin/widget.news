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

  var APPEARANCE_DEFAULTS = {
    title: "",
    theme: "site",
    widgetLimit: 5,
    borderless: false,
    showSummaries: true,
  };

  const params = new URLSearchParams(location.search);
  const loadForm = document.getElementById("load-form");
  const loadCard = document.getElementById("load-card");
  const listCard = document.getElementById("list-card");
  const manage = document.getElementById("manage-card");
  const widgetList = document.getElementById("widget-list");
  const loadErr = document.getElementById("load-error");
  const editErr = document.getElementById("edit-error");
  const editOk = document.getElementById("edit-ok");
  const loadBtn = loadForm.querySelector('button[type="submit"]');
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

  // Prefill: URL token (deep link) wins once, then permanent localStorage
  if (params.get("token")) {
    document.getElementById("token").value = params.get("token");
  } else if (getStoredToken()) {
    document.getElementById("token").value = getStoredToken();
  }

  function setNewWidgetLinks() {
    var href = localeHref("/") + "?new=1";
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
    var val = normalizeTheme(theme);
    if (themeInput) themeInput.value = val;
    if (!themeSegment) return;
    themeSegment.querySelectorAll("[data-theme]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-theme") === val);
    });
  }

  function authHeaders() {
    return { authorization: "Bearer " + state.token, "content-type": "application/json" };
  }

  function showOk(msg) {
    editOk.textContent = msg;
    editOk.hidden = false;
    editErr.hidden = true;
  }

  function showErr(msg) {
    editErr.textContent = msg;
    editErr.hidden = false;
    editOk.hidden = true;
  }

  function ensureEmbed(cb) {
    if (window.WidgetNews || window.NwNews) return cb();
    const s = document.createElement("script");
    s.src = "/embed.js";
    s.onload = cb;
    s.onerror = function () {
      showErr(t("sync_embed_fail"));
    };
    document.body.appendChild(s);
  }

  function readAppearanceFromForm() {
    return {
      title: document.getElementById("edit-title").value.trim(),
      theme: normalizeTheme(document.getElementById("edit-theme").value),
      widgetLimit: parseInt(document.getElementById("edit-limit").value, 10) || 5,
      borderless: document.getElementById("edit-borderless").checked,
      showSummaries: document.getElementById("edit-summaries").checked,
    };
  }

  function showPreview(publicId, appearance) {
    const host = document.getElementById("preview");
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
      var api = window.WidgetNews || window.NwNews;
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
    var el = document.getElementById(id);
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
    var when = data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : "—";
    var seen = data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString() : "—";
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
    var st = data.status === "paused" ? "paused" : "active";
    document.getElementById("edit-status").value = st;
    document.getElementById("embed-out").value = data.embed;
    document.getElementById("feed-out").value = data.feedUrl;
    manage.hidden = false;
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
    widgetList.innerHTML = "";
    widgets.forEach(function (w) {
      var li = document.createElement("li");
      li.className = "widget-list-item";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "widget-list-btn";
      btn.innerHTML =
        '<span class="widget-list-title"></span>' +
        '<span class="widget-list-meta"></span>' +
        '<span class="status-pill"></span>';
      btn.querySelector(".widget-list-title").textContent = widgetLabel(w);
      var when = w.lastSyncedAt ? new Date(w.lastSyncedAt).toLocaleDateString() : "—";
      btn.querySelector(".widget-list-meta").textContent = t("admin_list_meta", {
        when: when,
        period: w.period || "—",
      });
      var pill = btn.querySelector(".status-pill");
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
    loadErr.hidden = true;
    const token = document.getElementById("token").value.trim();
    if (!token) throw new Error(t("admin_no_widgets"));
    state.token = token;
    const res = await fetch("/api/widgets?token=" + encodeURIComponent(token));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    const widgets = data.widgets || (data.publicId ? [data] : []);
    if (!widgets.length) throw new Error(t("admin_no_widgets"));
    // Persist permanently after successful auth
    saveToken(token);
    state.widgets = widgets;
    state.scope = data.scope || "client";
    if (loadCard) loadCard.hidden = true;
    // Always show list when multiple; single non-root can open editor directly
    if (widgets.length === 1 && state.scope !== "root") {
      if (listCard) listCard.hidden = true;
      fill(widgets[0]);
    } else {
      manage.hidden = true;
      if (listCard) {
        listCard.hidden = false;
        renderList(widgets);
      }
    }
    if (location.search) {
      history.replaceState({}, "", localeHref("/admin"));
    }
  }

  function doLogout() {
    clearToken();
    state = { publicId: null, token: null, widgets: [], scope: null };
    manage.hidden = true;
    if (listCard) listCard.hidden = true;
    if (loadCard) loadCard.hidden = false;
    document.getElementById("token").value = "";
    loadErr.hidden = true;
  }

  loadForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    await withBusy(loadBtn, t("btn_loading"), async function () {
      try {
        await loadWidgets();
        showOk(t("loaded_ok"));
      } catch (err) {
        loadErr.textContent = err.message || String(err);
        loadErr.hidden = false;
      }
    });
  });

  // Auto-login from localStorage or ?token=
  if (params.get("token") || getStoredToken()) {
    withBusy(loadBtn, t("btn_loading"), async function () {
      try {
        await loadWidgets();
      } catch (err) {
        // Bad stored key — clear so user can re-enter
        if (getStoredToken() && !params.get("token")) {
          clearToken();
          document.getElementById("token").value = "";
        }
        loadErr.textContent = err.message || String(err);
        loadErr.hidden = false;
      }
    });
  }

  if (btnLogout) btnLogout.addEventListener("click", doLogout);
  if (btnLogoutManage) btnLogoutManage.addEventListener("click", doLogout);

  if (btnBackList) {
    btnBackList.addEventListener("click", function () {
      manage.hidden = true;
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

  document.getElementById("edit-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    editErr.hidden = true;
    editOk.hidden = true;
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
          numResults: Number(document.getElementById("edit-num").value),
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
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        // refresh list cache entry
        state.widgets = state.widgets.map(function (w) {
          return w.publicId === data.publicId ? data : w;
        });
        fill(data);
        showOk(t("saved_ok"));
      } catch (err) {
        showErr(err.message || String(err));
      }
    });
  });

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
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
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
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        state.widgets = state.widgets.filter(function (w) {
          return w.publicId !== state.publicId;
        });
        state.publicId = null;
        manage.hidden = true;
        if (state.widgets.length === 0) {
          if (listCard) listCard.hidden = true;
          if (loadCard) loadCard.hidden = false;
          state.token = null;
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
})();
