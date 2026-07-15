(function () {
  const params = new URLSearchParams(location.search);
  const loadForm = document.getElementById("load-form");
  const manage = document.getElementById("manage-card");
  const loadErr = document.getElementById("load-error");
  const editErr = document.getElementById("edit-error");
  const editOk = document.getElementById("edit-ok");
  const loadBtn = loadForm.querySelector('button[type="submit"]');
  const saveBtn = document.querySelector('#edit-form button[type="submit"]');
  const btnSync = document.getElementById("btn-sync");
  const btnRefresh = document.getElementById("btn-refresh");
  const btnDelete = document.getElementById("btn-delete");

  let state = { id: null, publicId: null, token: null };

  if (params.get("id")) document.getElementById("public-id").value = params.get("id");
  if (params.get("token")) document.getElementById("token").value = params.get("token");

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
      btn.appendChild(document.createTextNode(label || "Секунду…"));
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
      showErr("Не удалось загрузить embed.js");
    };
    document.body.appendChild(s);
  }

  function showPreview(publicId, theme, limit) {
    const host = document.getElementById("preview");
    host.classList.add("is-loading");
    host.innerHTML = "";
    const box = document.createElement("div");
    box.setAttribute("data-wn", publicId);
    box.setAttribute("data-theme", theme || "auto");
    box.setAttribute("data-limit", String(limit || 5));
    box.setAttribute("data-feed-base", location.origin);
    host.appendChild(box);
    ensureEmbed(function () {
      var api = window.WidgetNews || window.NwNews;
      if (api) api.mount(box);
      setTimeout(function () {
        host.classList.remove("is-loading");
      }, 350);
    });
  }

  function fill(data) {
    state.id = data.id;
    state.publicId = data.publicId;
    document.getElementById("widget-title").textContent =
      data.name || data.query.slice(0, 60) || data.publicId;
    document.getElementById("meta-line").textContent =
      "publicId=" +
      data.publicId +
      " · status=" +
      data.status +
      " · lastSynced=" +
      (data.lastSyncedAt || "—") +
      " · period=" +
      data.period;
    document.getElementById("edit-name").value = data.name || "";
    document.getElementById("edit-query").value = data.query;
    document.getElementById("edit-period").value = data.period;
    document.getElementById("edit-num").value = data.numResults;
    document.getElementById("edit-limit").value = data.widgetLimit;
    document.getElementById("edit-theme").value = data.theme;
    document.getElementById("edit-status").value = data.status;
    document.getElementById("embed-out").value = data.embed;
    document.getElementById("feed-out").value = data.feedUrl;
    manage.hidden = false;
    showPreview(data.publicId, data.theme, data.widgetLimit);
  }

  async function loadWidget() {
    loadErr.hidden = true;
    const publicId = document.getElementById("public-id").value.trim();
    const token = document.getElementById("token").value.trim();
    state.token = token;
    state.publicId = publicId;
    const res = await fetch(
      "/api/widgets/" + encodeURIComponent(publicId) + "?token=" + encodeURIComponent(token),
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    fill(data);
    if (location.search) {
      history.replaceState({}, "", "/admin");
    }
  }

  loadForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    await withBusy(loadBtn, "Загружаю…", async function () {
      try {
        await loadWidget();
        showOk("Виджет загружен");
      } catch (err) {
        loadErr.textContent = err.message || String(err);
        loadErr.hidden = false;
      }
    });
  });

  if (params.get("id") && params.get("token")) {
    withBusy(loadBtn, "Загружаю…", async function () {
      try {
        await loadWidget();
      } catch (err) {
        loadErr.textContent = err.message || String(err);
        loadErr.hidden = false;
      }
    });
  }

  document.getElementById("edit-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    editErr.hidden = true;
    editOk.hidden = true;
    if (!state.publicId || !state.token) {
      showErr("Сначала загрузите виджет");
      return;
    }
    await withBusy(saveBtn, "Сохраняю…", async function () {
      try {
        const body = {
          name: document.getElementById("edit-name").value.trim(),
          query: document.getElementById("edit-query").value.trim(),
          period: document.getElementById("edit-period").value,
          numResults: Number(document.getElementById("edit-num").value),
          widgetLimit: Number(document.getElementById("edit-limit").value),
          theme: document.getElementById("edit-theme").value,
          status: document.getElementById("edit-status").value,
        };
        const res = await fetch("/api/widgets/" + encodeURIComponent(state.publicId), {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        fill(data);
        showOk("Сохранено");
      } catch (err) {
        showErr(err.message || String(err));
      }
    });
  });

  btnSync.addEventListener("click", async function () {
    if (!state.publicId || !state.token) {
      showErr("Сначала загрузите виджет");
      return;
    }
    await withBusy(btnSync, "Sync…", async function () {
      try {
        const res = await fetch(
          "/api/widgets/" + encodeURIComponent(state.publicId) + "/sync",
          { method: "POST", headers: authHeaders() },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        showOk(
          data.synced
            ? "Synced " + (data.itemCount || 0) + " items"
            : "Sync: " + (data.reason || "waiting"),
        );
        showPreview(
          state.publicId,
          document.getElementById("edit-theme").value,
          Number(document.getElementById("edit-limit").value),
        );
      } catch (err) {
        showErr(err.message || String(err));
      }
    });
  });

  btnRefresh.addEventListener("click", async function () {
    if (!state.publicId || !state.token) {
      showErr("Сначала загрузите виджет");
      return;
    }
    await withBusy(btnRefresh, "Поиск…", async function () {
      try {
        const res = await fetch("/api/widgets/" + encodeURIComponent(state.publicId) + "/refresh", {
          method: "POST",
          headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        showOk(
          data.synced
            ? "Обновлено: " + (data.itemCount || 0) + " items"
            : "Refresh: " + (data.reason || "failed"),
        );
        showPreview(
          state.publicId,
          document.getElementById("edit-theme").value,
          Number(document.getElementById("edit-limit").value),
        );
      } catch (err) {
        showErr(err.message || String(err));
      }
    });
  });

  btnDelete.addEventListener("click", async function () {
    if (!state.publicId || !state.token) {
      showErr("Сначала загрузите виджет");
      return;
    }
    if (!confirm("Удалить виджет и feed?")) return;
    await withBusy(btnDelete, "Удаляю…", async function () {
      try {
        const res = await fetch("/api/widgets/" + encodeURIComponent(state.publicId), {
          method: "DELETE",
          headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        manage.hidden = true;
        state = { id: null, publicId: null, token: null };
        alert("Удалено");
      } catch (err) {
        showErr(err.message || String(err));
      }
    });
  });
})();
