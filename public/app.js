(function () {
  const form = document.getElementById("create-form");
  const errEl = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const resultCard = document.getElementById("result-card");
  const period = document.getElementById("period");
  const costHint = document.getElementById("cost-hint");
  const statusLine = document.getElementById("status-line");
  const syncStatus = document.getElementById("sync-status");
  const reloadPreview = document.getElementById("reload-preview");
  const syncBtn = document.getElementById("sync-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const copyEmbedBtn = document.getElementById("copy-embed");

  let state = { id: null, publicId: null, adminToken: null, feedUrl: null, pollTimer: null, theme: "auto", widgetLimit: 5 };
  let previewBox = null;

  const runsPerMonth = { "1h": 720, "6h": 120, "1d": 30, "7d": 4 };

  /** Show spinner + label while async work runs. */
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

  function flashOk(btn, okLabel, ms) {
    if (!btn) return;
    const prev = btn.dataset.idleLabel || btn.textContent;
    btn.classList.add("is-ok");
    btn.textContent = okLabel || "Готово";
    setTimeout(function () {
      btn.classList.remove("is-ok");
      btn.textContent = prev;
    }, ms || 1400);
  }

  function setSyncStatus(text, kind) {
    syncStatus.textContent = text || "";
    syncStatus.className = "hint flash" + (kind ? " is-" + kind : "");
  }

  function updateCost() {
    const p = period.value;
    const runs = runsPerMonth[p] || 30;
    const usd = (runs * 0.007).toFixed(2);
    costHint.textContent =
      "Оценка Exa Search: ~$0.007/search × ~" +
      runs +
      " /мес ≈ $" +
      usd +
      "/мес + Workers AI summary (копейки). Hourly ≈ в 24× дороже daily.";
  }
  period.addEventListener("change", updateCost);
  updateCost();

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
      const ok = await withBusy(btn, "Копирую…", function () {
        return copyText(el.value);
      });
      if (ok) flashOk(btn, "Скопировано");
      else {
        el.focus();
        el.select && el.select();
        setSyncStatus("Не удалось скопировать — выделите поле вручную", "err");
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
      setSyncStatus("Не удалось загрузить embed.js", "err");
    };
    document.body.appendChild(s);
  }

  function mountPreview(publicId, theme, limit) {
    const host = document.getElementById("preview-host");
    host.classList.add("is-loading");
    host.innerHTML = "";
    previewBox = document.createElement("div");
    previewBox.setAttribute("data-wn", publicId);
    previewBox.setAttribute("data-theme", theme || "auto");
    previewBox.setAttribute("data-limit", String(limit || 5));
    previewBox.setAttribute("data-feed-base", location.origin);
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
      setSyncStatus("Сначала создайте виджет", "err");
      return;
    }
    var api = window.WidgetNews || window.NwNews;
    if (previewBox && api) {
      const host = document.getElementById("preview-host");
      host.classList.add("is-loading");
      api.mount(previewBox);
      setTimeout(function () {
        host.classList.remove("is-loading");
      }, 400);
    } else {
      mountPreview(state.publicId, state.theme, state.widgetLimit);
    }
  }

  function requireWidget() {
    if (!state.id || !state.adminToken) {
      setSyncStatus("Нет активного виджета — создайте новый или обновите страницу после создания.", "err");
      return false;
    }
    return true;
  }

  function persistState() {
    try {
      sessionStorage.setItem(
        "wn_last_widget",
        JSON.stringify({
          id: state.id,
          publicId: state.publicId,
          token: state.adminToken,
          feedUrl: state.feedUrl,
          theme: state.theme,
          widgetLimit: state.widgetLimit,
        }),
      );
    } catch (_) {}
  }

  function applyWidgetResponse(data, opts) {
    opts = opts || {};
    state = {
      id: data.id,
      publicId: data.publicId,
      adminToken: data.adminToken || state.adminToken,
      feedUrl: data.feedUrl,
      pollTimer: state.pollTimer,
      theme: data.theme || state.theme || "auto",
      widgetLimit: data.widgetLimit || state.widgetLimit || 5,
    };
    if (data.adminToken) {
      document.getElementById("admin-token").value = data.adminToken;
    }
    if (data.adminUrl) {
      document.getElementById("admin-link").value = data.adminUrl;
      document.getElementById("open-admin").href = data.adminUrl;
    }
    document.getElementById("feed-url").value = data.feedUrl || "";
    document.getElementById("embed-code").value = data.embed || "";
    resultCard.hidden = false;
    persistState();
    if (opts.mount !== false) {
      mountPreview(state.publicId, state.theme, state.widgetLimit);
    }
  }

  async function pollSync(maxAttempts) {
    let n = 0;
    if (state.pollTimer) clearInterval(state.pollTimer);
    setSyncStatus("Идёт поиск Exa + summary (Workers AI)…");
    statusLine.textContent = "Виджет создан. Идёт первый поиск…";
    statusLine.className = "ok";

    const tick = async function () {
      n++;
      try {
        // Do NOT POST /sync here — create already waitUntil(refresh). Polling GET avoids a second paid search.
        const res = await fetch(
          "/api/widgets/" +
            encodeURIComponent(state.id) +
            "?token=" +
            encodeURIComponent(state.adminToken),
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);

        if (data.lastSyncedAt) {
          setSyncStatus(
            "Feed готов (synced " +
              new Date(data.lastSyncedAt).toLocaleString() +
              "). Preview обновлён.",
            "ok",
          );
          statusLine.textContent = "Готово — лента заполнена.";
          statusLine.className = "ok";
          refreshPreview();
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          return;
        }
        setSyncStatus("Попытка " + n + "/" + maxAttempts + ": ждём first search…");
        refreshPreview();
      } catch (e) {
        setSyncStatus("Статус: " + (e.message || e), "err");
      }
      if (n >= maxAttempts) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        setSyncStatus(
          "Таймаут ожидания. Нажмите «Обновить поиск» только если лента пуста (иначе будет второй search).",
          "err",
        );
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
    await withBusy(submitBtn, "Создаём…", async function () {
      try {
        const body = {
          name: document.getElementById("name").value.trim() || undefined,
          query: document.getElementById("query").value.trim(),
          period: document.getElementById("period").value,
          numResults: Number(document.getElementById("numResults").value),
          widgetLimit: Number(document.getElementById("widgetLimit").value),
          theme: document.getElementById("theme").value,
        };
        const res = await fetch("/api/widgets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);

        applyWidgetResponse(data, { mount: true });
        resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setSyncStatus("Виджет создан — идёт поиск…");
        pollSync(12);
      } catch (err) {
        errEl.textContent = err.message || String(err);
        errEl.hidden = false;
      }
    });
  });

  copyEmbedBtn.addEventListener("click", async function () {
    const ta = document.getElementById("embed-code");
    const ok = await withBusy(copyEmbedBtn, "Копирую…", function () {
      return copyText(ta.value);
    });
    if (ok) flashOk(copyEmbedBtn, "Скопировано");
    else {
      ta.focus();
      ta.select();
      setSyncStatus("Не удалось скопировать — выделите код вручную", "err");
    }
  });

  syncBtn.addEventListener("click", async function () {
    if (!requireWidget()) return;
    await withBusy(syncBtn, "Обновление…", async function () {
      try {
        setSyncStatus("Exa Search + Workers AI…");
        const res = await fetch("/api/widgets/" + state.id + "/sync", {
          method: "POST",
          headers: { authorization: "Bearer " + state.adminToken },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        if (data.synced) {
          setSyncStatus("Synced: " + (data.itemCount || 0) + " items", "ok");
        } else {
          setSyncStatus("Sync: " + (data.reason || "no data"), "err");
        }
        refreshPreview();
      } catch (err) {
        setSyncStatus(err.message || String(err), "err");
      }
    });
  });

  refreshBtn.addEventListener("click", async function () {
    if (!requireWidget()) return;
    await withBusy(refreshBtn, "Поиск…", async function () {
      try {
        setSyncStatus("Exa Search + summary…");
        const res = await fetch("/api/widgets/" + state.id + "/refresh", {
          method: "POST",
          headers: { authorization: "Bearer " + state.adminToken },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        if (data.synced) {
          setSyncStatus("Готово: " + (data.itemCount || 0) + " items", "ok");
          refreshPreview();
        } else {
          setSyncStatus(data.reason || "не удалось", "err");
        }
      } catch (err) {
        setSyncStatus(err.message || String(err), "err");
      }
    });
  });

  reloadPreview.addEventListener("click", async function () {
    if (!state.publicId) {
      setSyncStatus("Сначала создайте виджет", "err");
      return;
    }
    await withBusy(reloadPreview, "Обновляю…", async function () {
      refreshPreview();
      // give fetch a moment so spinner is visible
      await new Promise(function (r) {
        setTimeout(r, 450);
      });
      setSyncStatus("Preview обновлён", "ok");
    });
  });

  // Restore last widget so buttons work after page reload
  try {
    const raw =
      sessionStorage.getItem("wn_last_widget") || sessionStorage.getItem("nw_last_widget");
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.id && saved.token && saved.publicId) {
        state = {
          id: saved.id,
          publicId: saved.publicId,
          adminToken: saved.token,
          feedUrl: saved.feedUrl || null,
          pollTimer: null,
          theme: saved.theme || "auto",
          widgetLimit: saved.widgetLimit || 5,
        };
        document.getElementById("admin-token").value = saved.token;
        document.getElementById("admin-link").value =
          location.origin +
          "/admin/?id=" +
          encodeURIComponent(saved.publicId) +
          "&token=" +
          encodeURIComponent(saved.token);
        document.getElementById("open-admin").href = document.getElementById("admin-link").value;
        if (saved.feedUrl) document.getElementById("feed-url").value = saved.feedUrl;
        resultCard.hidden = false;
        statusLine.textContent = "Восстановлен последний виджет из этой сессии.";
        statusLine.className = "ok";
        setSyncStatus("Можно синхронизировать feed или обновить preview.");
        mountPreview(state.publicId, state.theme, state.widgetLimit);
        // Refresh meta (embed etc.) in background
        fetch("/api/widgets/" + encodeURIComponent(saved.publicId) + "?token=" + encodeURIComponent(saved.token))
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (x) {
            if (!x.ok) return;
            if (x.d.feedUrl) document.getElementById("feed-url").value = x.d.feedUrl;
            if (x.d.embed) document.getElementById("embed-code").value = x.d.embed;
            if (x.d.adminUrl) {
              document.getElementById("admin-link").value = x.d.adminUrl;
              document.getElementById("open-admin").href = x.d.adminUrl;
            }
            state.theme = x.d.theme || state.theme;
            state.widgetLimit = x.d.widgetLimit || state.widgetLimit;
            state.id = x.d.id || state.id;
            persistState();
          })
          .catch(function () {});
      }
    }
  } catch (_) {}
})();
