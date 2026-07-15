(function () {
  "use strict";

  function scriptOrigin() {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (s) return new URL(s).origin;
    } catch (e) {}
    return "";
  }

  var DEFAULT_FEED_BASE =
    (document.currentScript && document.currentScript.getAttribute("data-feed-base")) ||
    scriptOrigin();

  function css(theme) {
    var isDark =
      theme === "dark" ||
      (theme === "auto" &&
        typeof matchMedia !== "undefined" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    return {
      dark: isDark,
      bg: isDark ? "#121722" : "#fffdf9",
      fg: isDark ? "#f3f0ea" : "#0b1220",
      muted: isDark ? "#9aa3b5" : "#5c6578",
      border: isDark ? "#252c3d" : "#e4ddd2",
      link: isDark ? "#ff7a33" : "#e85d04",
      accent: isDark ? "#ff7a33" : "#e85d04",
      head: isDark ? "#9aa3b5" : "#5c6578",
    };
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "style" && typeof attrs[k] === "object") {
          Object.assign(n.style, attrs[k]);
        } else if (k === "text") {
          n.textContent = attrs[k];
        } else {
          n.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach(function (c) {
      if (c) n.appendChild(c);
    });
    return n;
  }

  function formatDate(d) {
    if (!d) return "";
    try {
      var cleaned = String(d).replace(" ", "T").replace(/\.\d+$/, "");
      var dt = new Date(cleaned);
      if (isNaN(dt.getTime())) dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d).slice(0, 10);
      return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return String(d).slice(0, 10);
    }
  }

  function truncate(s, n) {
    if (!s) return "";
    s = String(s).trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1).trim() + "…";
  }

  function cleanSummary(raw) {
    if (!raw) return "";
    var s = String(raw).trim();
    var label =
      /^(?:ключевые\s+моменты(?:\s+статьи)?|ключевой\s+вывод(?:\s+статьи)?|ключове\s+з\s+матеріалу|краткое\s+резюме|краткое\s+содержание|summary|key\s+(?:takeaways?|points?|findings?)|main\s+points?|article\s+summary|tl;?dr)\s*[:：\-—–]?\s*/i;
    for (var i = 0; i < 3; i++) {
      var next = s.replace(label, "").trim();
      if (next === s) break;
      s = next;
    }
    s = s.replace(/^[\s]*[-•*–—]\s+/, "").trim();
    s = s.replace(/\s+-\s+/g, " · ").replace(/\s+/g, " ").trim();
    return s;
  }

  function hostId(host) {
    return (
      host.getAttribute("data-wn") ||
      host.getAttribute("data-nw") ||
      host.getAttribute("data-public-id")
    );
  }

  function render(host, data, limit, theme) {
    var t = css(theme || data.theme || "auto");
    var shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.innerHTML = "";

    var style = el("style", {
      text:
        ":host{all:initial;font-family:DM Sans,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:block;}" +
        ".wn{color:" +
        t.fg +
        ";background:" +
        t.bg +
        ";border:1px solid " +
        t.border +
        ";border-radius:12px;padding:14px 16px;line-height:1.45;}" +
        ".wn .head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 12px;}" +
        ".wn h3{margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:" +
        t.head +
        ";}" +
        ".wn .badge{font-size:10px;font-weight:650;color:" +
        t.accent +
        ";letter-spacing:.02em;}" +
        ".wn ul{list-style:none;margin:0;padding:0;}" +
        ".wn li{padding:11px 0;border-top:1px solid " +
        t.border +
        ";}" +
        ".wn li:first-child{border-top:none;padding-top:0;}" +
        ".wn a{color:" +
        t.link +
        ";text-decoration:none;font-weight:650;font-size:15px;letter-spacing:-.01em;}" +
        ".wn a:hover{text-decoration:underline;text-underline-offset:2px;}" +
        ".wn .meta{font-size:12px;color:" +
        t.muted +
        ";margin-top:4px;}" +
        ".wn .sum{font-size:13px;color:" +
        t.fg +
        ";opacity:.88;margin-top:5px;line-height:1.45;}" +
        ".wn .empty,.wn .err{font-size:13px;color:" +
        t.muted +
        ";}",
    });

    var root = el("div", { class: "wn", role: "region", "aria-label": "News widget" });
    var head = el("div", { class: "head" });
    head.appendChild(el("h3", { text: "Latest" }));
    head.appendChild(el("span", { class: "badge", text: "widget.news" }));
    root.appendChild(head);

    var items = (data.items || []).slice(0, limit || data.widgetLimit || 5);
    if (!items.length) {
      root.appendChild(el("div", { class: "empty", text: "No stories yet — check back soon." }));
    } else {
      var ul = el("ul");
      items.forEach(function (item) {
        var li = el("li");
        li.appendChild(
          el("a", {
            href: item.url,
            target: "_blank",
            rel: "noopener noreferrer",
            text: item.title,
          }),
        );
        var meta = [item.source, formatDate(item.publishedDate)].filter(Boolean).join(" · ");
        if (meta) li.appendChild(el("div", { class: "meta", text: meta }));
        var sum = cleanSummary(item.summary);
        if (sum) {
          li.appendChild(el("div", { class: "sum", text: truncate(sum, 220) }));
        }
        ul.appendChild(li);
      });
      root.appendChild(ul);
    }

    shadow.appendChild(style);
    shadow.appendChild(root);
  }

  function mount(host) {
    var id = hostId(host);
    if (!id) return;
    var limit = parseInt(host.getAttribute("data-limit") || "5", 10);
    var theme = host.getAttribute("data-theme") || "auto";
    var base = (host.getAttribute("data-feed-base") || DEFAULT_FEED_BASE || "").replace(/\/$/, "");
    if (!base) {
      console.warn("[widget.news] missing feed base");
      return;
    }
    var url = base + "/f/" + encodeURIComponent(id) + ".json?_=" + Date.now();

    host.textContent = "";
    fetch(url, { credentials: "omit", mode: "cors", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("feed " + r.status);
        return r.json();
      })
      .then(function (data) {
        render(host, data, limit, theme);
      })
      .catch(function () {
        var t = css(theme);
        var shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
        shadow.innerHTML = "";
        shadow.appendChild(
          el("div", {
            style: {
              fontFamily: "system-ui,sans-serif",
              fontSize: "13px",
              color: t.muted,
              border: "1px solid " + t.border,
              borderRadius: "12px",
              padding: "12px 14px",
              background: t.bg,
            },
            text: "Unable to load news.",
          }),
        );
      });
  }

  function boot() {
    var nodes = document.querySelectorAll("[data-wn], [data-nw], [data-public-id]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  var api = { mount: mount, boot: boot };
  window.WidgetNews = api;
  // Back-compat with earlier embeds
  window.NwNews = api;
})();
