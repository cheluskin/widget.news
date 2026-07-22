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

  var SCRIPT_ORIGIN = scriptOrigin();

  /**
   * Themes:
   * - site (default, legacy "auto"): inherit host page font/color so the widget
   *   blends into the publisher site. Preview uses whatever page hosts it.
   * - light / dark: self-contained Google News–style palettes.
   */
  function normalizeTheme(theme) {
    if (theme === "light" || theme === "dark") return theme;
    return "site";
  }

  function css(theme) {
    var mode = normalizeTheme(theme);
    if (mode === "site") {
      return {
        mode: "site",
        inherit: true,
        dark: false,
        bg: "transparent",
        surface: "transparent",
        fg: "inherit",
        muted: "color-mix(in srgb, currentColor 62%, transparent)",
        border: "color-mix(in srgb, currentColor 16%, transparent)",
        hover: "color-mix(in srgb, currentColor 6%, transparent)",
        link: "inherit",
        accent: "currentColor",
        brand: "color-mix(in srgb, currentColor 62%, transparent)",
        avatarBg: "color-mix(in srgb, currentColor 12%, transparent)",
        avatarFg: "inherit",
      };
    }
    if (mode === "dark") {
      return {
        mode: "dark",
        inherit: false,
        dark: true,
        bg: "#202124",
        surface: "#292a2d",
        fg: "#e8eaed",
        muted: "#9aa0a6",
        border: "#3c4043",
        hover: "rgba(232, 234, 237, 0.06)",
        link: "#8ab4f8",
        accent: "#8ab4f8",
        brand: "#f28b82",
        avatarBg: "#3c4043",
        avatarFg: "#e8eaed",
      };
    }
    // light — Google News / Material surfaces
    return {
      mode: "light",
      inherit: false,
      dark: false,
      bg: "#ffffff",
      surface: "#ffffff",
      fg: "#202124",
      muted: "#5f6368",
      border: "#dadce0",
      hover: "rgba(32, 33, 36, 0.04)",
      link: "#1a73e8",
      accent: "#1a73e8",
      brand: "#d93025",
      avatarBg: "#e8f0fe",
      avatarFg: "#1967d2",
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
        } else if (k === "html") {
          n.innerHTML = attrs[k];
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

  /** Relative time like Google News: "2 hours ago", "Yesterday", "Mar 3". */
  function formatRelative(d) {
    if (!d) return "";
    try {
      var cleaned = String(d).replace(" ", "T").replace(/\.\d+$/, "");
      var dt = new Date(cleaned);
      if (isNaN(dt.getTime())) dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d).slice(0, 10);

      var now = Date.now();
      var diff = now - dt.getTime();
      if (diff < 0) diff = 0;

      var sec = Math.floor(diff / 1000);
      var min = Math.floor(sec / 60);
      var hr = Math.floor(min / 60);
      var day = Math.floor(hr / 24);

      if (min < 1) return "Just now";
      if (min < 60) return min === 1 ? "1 minute ago" : min + " minutes ago";
      if (hr < 24) return hr === 1 ? "1 hour ago" : hr + " hours ago";
      if (day === 1) return "Yesterday";
      if (day < 7) return day + " days ago";

      return dt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: dt.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      });
    } catch (e) {
      return String(d).slice(0, 10);
    }
  }

  /** Soft trim to ~2 lines; prefer sentence/word break (server already finalizes). */
  function softTrim(s, n) {
    if (!s) return "";
    s = String(s).replace(/\s+/g, " ").trim();
    if (s.length <= n) return s;
    var window = s.slice(0, n - 1);
    var sentenceEnd = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
    );
    if (sentenceEnd >= Math.floor(n * 0.45)) {
      return window.slice(0, sentenceEnd + 1).trim();
    }
    var sp = window.lastIndexOf(" ");
    if (sp >= Math.floor(n * 0.5)) {
      return window.slice(0, sp).replace(/[,:;·\-–—]+$/, "").trim() + "…";
    }
    return window.trim() + "…";
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
    s = s.replace(/^["«“„']+|["»”']+$/g, "").trim();
    s = s.replace(/^[\s]*[-•*–—]\s+/, "").trim();
    s = s.replace(/\s+-\s+/g, " · ").replace(/\s+/g, " ").trim();
    return s;
  }

  /** Stable pastel-ish hue from source name (Google-like publisher chip). */
  function avatarColors(name, t) {
    if (t.inherit) {
      return { bg: t.avatarBg, fg: t.avatarFg };
    }
    var s = (name || "?").toLowerCase();
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    // Google News-ish publisher palette (readable on white / dark)
    var light = [
      ["#e8f0fe", "#1967d2"],
      ["#fce8e6", "#c5221f"],
      ["#e6f4ea", "#137333"],
      ["#fef7e0", "#b06000"],
      ["#f3e8fd", "#7627bb"],
      ["#e8eaed", "#3c4043"],
      ["#e0f7fa", "#00796b"],
      ["#fff3e0", "#e65100"],
    ];
    var dark = [
      ["#394457", "#8ab4f8"],
      ["#5c2b29", "#f28b82"],
      ["#1e3a2f", "#81c995"],
      ["#4a3c1a", "#fdd663"],
      ["#3c2a4d", "#d7aefb"],
      ["#3c4043", "#e8eaed"],
      ["#1a3a3a", "#78d9c6"],
      ["#4a3020", "#fbbc04"],
    ];
    var pair = (t.dark ? dark : light)[h % light.length];
    return { bg: pair[0], fg: pair[1] };
  }

  function sourceHost(item) {
    try {
      if (item.url) return new URL(item.url).hostname.replace(/^www\./, "");
    } catch (e) {}
    if (item.source) {
      var s = String(item.source).replace(/^www\./, "").trim();
      // already a hostname
      if (s && s.indexOf(" ") === -1) return s;
    }
    return "";
  }

  function sourceLabel(item) {
    var host = sourceHost(item);
    if (host) return host;
    if (item.source) return String(item.source).replace(/^www\./, "");
    return "Source";
  }

  /**
   * Publisher favicon — same approach as Google News chips.
   * Feed has no logo field (only hostname); we resolve via Google's favicon CDN.
   */
  function faviconUrl(host) {
    if (!host) return "";
    return (
      "https://www.google.com/s2/favicons?domain=" +
      encodeURIComponent(host) +
      "&sz=64"
    );
  }

  function publisherIcon(item, t) {
    var source = sourceLabel(item);
    var host = sourceHost(item);
    var av = avatarColors(source, t);
    var letter = (source.charAt(0) || "?").toUpperCase();
    var wrap = el("span", {
      class: "avatar is-letter",
      style: { background: av.bg, color: av.fg },
      "aria-hidden": "true",
    });
    wrap.textContent = letter;

    if (!host) return wrap;

    var img = el("img", {
      src: faviconUrl(host),
      alt: "",
      width: "20",
      height: "20",
      loading: "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer",
    });
    img.onload = function () {
      wrap.classList.remove("is-letter");
      wrap.style.background = t.inherit ? "transparent" : t.dark ? "#292a2d" : "#fff";
      wrap.style.color = "";
      wrap.textContent = "";
      wrap.appendChild(img);
    };
    img.onerror = function () {
      /* keep letter avatar */
    };
    return wrap;
  }

  function hostId(host) {
    return (
      host.getAttribute("data-wn") ||
      host.getAttribute("data-nw") ||
      host.getAttribute("data-public-id")
    );
  }

  function parseBoolAttr(host, name, fallback) {
    var v = host.getAttribute(name);
    if (v === null || v === "") return fallback;
    if (v === "0" || v === "false" || v === "no" || v === "off") return false;
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
    return fallback;
  }

  function styles(t, borderless) {
    var hostCss = t.inherit
      ? ":host{display:block;color:inherit;font:inherit;line-height:inherit;}"
      : ":host{all:initial;display:block;" +
        "font-family:Roboto,Google Sans,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;" +
        "-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}";

    var fontBody = t.inherit
      ? "font:inherit;"
      : "font-family:inherit;";

    var titleHover = t.inherit
      ? ".wn a.story:hover .title{text-decoration:underline;text-underline-offset:2px;}"
      : ".wn a.story:hover .title{color:" + t.link + ";}";

    var brandHover = t.inherit
      ? ".wn .brand:hover,.wn .foot a:hover{opacity:1;}"
      : ".wn .brand:hover{color:" +
        t.link +
        ";}" +
        ".wn .foot a:hover{color:" +
        t.link +
        ";}";

    var avatarCss = t.inherit
      ? ".wn .avatar{width:20px;height:20px;border-radius:50%;flex-shrink:0;" +
        "display:inline-flex;align-items:center;justify-content:center;" +
        "font-size:11px;font-weight:600;line-height:1;overflow:hidden;" +
        "background:" +
        t.avatarBg +
        ";color:" +
        t.avatarFg +
        ";}" +
        ".wn .avatar img{width:100%;height:100%;object-fit:contain;display:block;background:transparent;}"
      : ".wn .avatar{width:20px;height:20px;border-radius:50%;flex-shrink:0;" +
        "display:inline-flex;align-items:center;justify-content:center;" +
        "font-size:11px;font-weight:600;line-height:1;overflow:hidden;" +
        "background:" +
        (t.dark ? "#3c4043" : "#e8eaed") +
        ";}" +
        ".wn .avatar img{width:100%;height:100%;object-fit:contain;display:block;" +
        "background:" +
        (t.dark ? "#292a2d" : "#fff") +
        ";}";

    var cardBorder = borderless
      ? "border:none;border-radius:0;"
      : "border:1px solid " + t.border + ";border-radius:8px;";

    return (
      hostCss +
      ".wn{" +
      fontBody +
      "color:" +
      t.fg +
      ";background:" +
      t.bg +
      ";" +
      cardBorder +
      "overflow:hidden;}" +
      /* Header — Google News “Top stories” bar */
      ".wn .head{display:flex;align-items:center;justify-content:space-between;gap:12px;" +
      "padding:12px 16px 10px;border-bottom:1px solid " +
      t.border +
      ";}" +
      ".wn .head-left{display:flex;align-items:center;gap:8px;min-width:0;}" +
      ".wn .gicon{width:18px;height:18px;flex-shrink:0;display:block;}" +
      ".wn .head-title{margin:0;font-size:14px;font-weight:500;letter-spacing:.015em;color:" +
      t.fg +
      ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".wn .brand{font-size:11px;font-weight:500;color:" +
      t.muted +
      ";text-decoration:none;white-space:nowrap;}" +
      /* Story list */
      ".wn ul{list-style:none;margin:0;padding:0;}" +
      ".wn li{margin:0;padding:0;border-top:1px solid " +
      t.border +
      ";}" +
      ".wn li:first-child{border-top:none;}" +
      ".wn a.story{display:block;padding:14px 16px;text-decoration:none;color:inherit;" +
      "transition:background .12s ease;outline:none;}" +
      ".wn a.story:hover,.wn a.story:focus-visible{background:" +
      t.hover +
      ";}" +
      ".wn a.story:focus-visible{box-shadow:inset 0 0 0 2px " +
      t.accent +
      ";}" +
      /* Publisher row + real favicon (Google News-style) */
      ".wn .pub{display:flex;align-items:center;gap:8px;margin:0 0 6px;min-width:0;}" +
      avatarCss +
      ".wn .avatar.is-letter{/* letter fallback only */}" +
      ".wn .source{font-size:12px;font-weight:500;color:" +
      t.fg +
      ";letter-spacing:.01em;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      /* Headline — scannable, 3-line clamp like GN */
      ".wn .title{margin:0;font-size:16px;font-weight:400;line-height:1.35;letter-spacing:0;" +
      "color:" +
      t.fg +
      ";display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;}" +
      ".wn li:first-child .title{font-size:17px;font-weight:500;line-height:1.32;}" +
      titleHover +
      /* Snippet */
      ".wn .sum{margin:6px 0 0;font-size:13px;line-height:1.45;color:" +
      t.muted +
      ";display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}" +
      /* Meta time */
      ".wn .meta{margin:8px 0 0;font-size:12px;line-height:1.2;color:" +
      t.muted +
      ";}" +
      ".wn .empty,.wn .err{padding:20px 16px;font-size:13px;color:" +
      t.muted +
      ";text-align:center;}" +
      /* Compact footer — brand when no section title */
      ".wn .foot{display:flex;align-items:center;justify-content:flex-end;" +
      "padding:8px 14px;border-top:1px solid " +
      t.border +
      ";}" +
      ".wn .foot a{font-size:11px;color:" +
      t.muted +
      ";text-decoration:none;}" +
      brandHover
    );
  }

  /** Small multicolor “news” mark (not Google logo — original). */
  function newsIcon(t) {
    var svg = el("svg", {
      class: "gicon",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      focusable: "false",
    });
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Four tiles like a news mosaic
    var tiles = t.inherit
      ? [
          { x: 2, y: 3, w: 9, h: 8, c: "currentColor", o: "0.92" },
          { x: 13, y: 3, w: 9, h: 8, c: "currentColor", o: "0.55" },
          { x: 2, y: 13, w: 9, h: 8, c: "currentColor", o: "0.4" },
          { x: 13, y: 13, w: 9, h: 8, c: "currentColor", o: "0.72" },
        ]
      : [
          { x: 2, y: 3, w: 9, h: 8, c: t.dark ? "#8ab4f8" : "#1a73e8" },
          { x: 13, y: 3, w: 9, h: 8, c: t.dark ? "#f28b82" : "#ea4335" },
          { x: 2, y: 13, w: 9, h: 8, c: t.dark ? "#fdd663" : "#fbbc04" },
          { x: 13, y: 13, w: 9, h: 8, c: t.dark ? "#81c995" : "#34a853" },
        ];
    tiles.forEach(function (tile) {
      var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(tile.x));
      r.setAttribute("y", String(tile.y));
      r.setAttribute("width", String(tile.w));
      r.setAttribute("height", String(tile.h));
      r.setAttribute("rx", "1.5");
      r.setAttribute("fill", tile.c);
      if (tile.o) r.setAttribute("fill-opacity", tile.o);
      svg.appendChild(r);
    });
    return svg;
  }

  function brandLink(t) {
    return el("a", {
      class: "brand",
      href: "https://widget.news",
      target: "_blank",
      rel: "noopener noreferrer",
      text: "widget.news",
    });
  }

  function renderStory(item, t, isLead, showSummaries) {
    var source = sourceLabel(item);
    var a = el("a", {
      class: "story",
      href: item.url,
      target: "_blank",
      rel: "noopener noreferrer",
    });

    var pub = el("div", { class: "pub" });
    pub.appendChild(publisherIcon(item, t));
    pub.appendChild(el("span", { class: "source", text: source }));
    a.appendChild(pub);

    a.appendChild(
      el("h4", {
        class: "title",
        text: item.title || item.url || "Untitled",
      }),
    );

    if (showSummaries) {
      // Server aims for ~2 lines (~150 chars); soft-trim only as safety net
      var sum = cleanSummary(item.summary);
      if (sum) {
        a.appendChild(
          el("p", {
            class: "sum",
            text: softTrim(sum, isLead ? 170 : 150),
          }),
        );
      }
    }

    var when = formatRelative(item.publishedDate || item.seenAt);
    if (when) a.appendChild(el("div", { class: "meta", text: when }));

    return a;
  }

  /**
   * Section title: data-title attr → feed.title → none (no query fallback).
   * Empty title → no header; brand moves to footer.
   */
  function resolveTitle(host, data) {
    var fromAttr = (host.getAttribute("data-title") || "").trim();
    if (fromAttr) return fromAttr;
    if (data && data.title != null && String(data.title).trim()) {
      return String(data.title).trim();
    }
    return "";
  }

  function render(host, data, opts) {
    var theme = opts.theme || data.theme || "site";
    var limit = opts.limit || data.widgetLimit || 5;
    var borderless =
      opts.borderless != null
        ? opts.borderless
        : data.borderless === true || data.borderless === 1;
    var showSummaries =
      opts.showSummaries != null
        ? opts.showSummaries
        : data.showSummaries !== false && data.showSummaries !== 0;

    var t = css(theme);
    var shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.innerHTML = "";

    var style = el("style", { text: styles(t, borderless) });
    var root = el("div", { class: "wn", role: "region", "aria-label": "News" });

    var sectionTitle = resolveTitle(host, data);
    if (sectionTitle) {
      if (sectionTitle.length > 48) sectionTitle = sectionTitle.slice(0, 47).trim() + "…";
      var head = el("div", { class: "head" });
      var headLeft = el("div", { class: "head-left" });
      headLeft.appendChild(newsIcon(t));
      headLeft.appendChild(el("h3", { class: "head-title", text: sectionTitle }));
      head.appendChild(headLeft);
      head.appendChild(brandLink(t));
      root.appendChild(head);
    }

    var items = (data.items || []).slice(0, limit);
    if (!items.length) {
      root.appendChild(el("div", { class: "empty", text: "No stories yet — check back soon." }));
    } else {
      var ul = el("ul");
      items.forEach(function (item, idx) {
        var li = el("li");
        li.appendChild(renderStory(item, t, idx === 0, showSummaries));
        ul.appendChild(li);
      });
      root.appendChild(ul);
    }

    // No title → brand at bottom (was in header)
    if (!sectionTitle) {
      var foot = el("div", { class: "foot" });
      foot.appendChild(brandLink(t));
      root.appendChild(foot);
    }

    shadow.appendChild(style);
    shadow.appendChild(root);
  }

  /** Tell worker this public id is still viewed (throttled client-side & server-side). */
  function pingSeen(publicId) {
    if (!publicId) return;
    try {
      var key = "wn_seen_" + publicId;
      var last = sessionStorage.getItem(key);
      if (last && Date.now() - parseInt(last, 10) < 6 * 3600 * 1000) {
        return; // Skip: presence already sent recently in this browser session
      }
      sessionStorage.setItem(key, String(Date.now()));
    } catch (e) {}

    var base = (SCRIPT_ORIGIN || location.origin || "").replace(/\/$/, "");
    if (!base) return;
    // Skip beacons from admin/builder preview (cache-bust host)
    var url = base + "/api/v/" + encodeURIComponent(publicId);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
        return;
      }
    } catch (e) {}
    try {
      fetch(url, { method: "POST", mode: "cors", credentials: "omit", keepalive: true }).catch(
        function () {},
      );
    } catch (e) {}
  }

  function mount(host) {
    var id = hostId(host);
    if (!id) return;
    var limit = parseInt(host.getAttribute("data-limit") || "5", 10);
    var theme = host.getAttribute("data-theme") || "site";
    var borderless = parseBoolAttr(host, "data-borderless", false);
    var showSummaries = parseBoolAttr(host, "data-summaries", true);
    var base = (host.getAttribute("data-feed-base") || DEFAULT_FEED_BASE || "").replace(/\/$/, "");
    if (!base) {
      console.warn("[widget.news] missing feed base");
      return;
    }
    // Stable URL so CF edge + browser can cache (do NOT add ?_=Date.now()).
    // Optional data-cache-bust="1" for admin preview after manual refresh.
    var url = base + "/f/" + encodeURIComponent(id) + ".json";
    var bust = host.getAttribute("data-cache-bust");
    if (bust === "1" || bust === "true") {
      url += "?_=" + Date.now();
    }

    // Presence once per mount (not on admin cache-bust loops if data-no-ping)
    var noPing = host.getAttribute("data-no-ping");
    if (noPing !== "1" && noPing !== "true") {
      pingSeen(id);
    }

    host.textContent = "";
    // cache: default — browser honors Cache-Control (max-age=60 on feeds)
    fetch(url, { credentials: "omit", mode: "cors" })
      .then(function (r) {
        if (!r.ok) throw new Error("feed " + r.status);
        return r.json();
      })
      .then(function (data) {
        // Attrs override feed defaults when explicitly set on host
        var opts = {
          theme: theme,
          limit: limit,
          borderless: host.hasAttribute("data-borderless")
            ? borderless
            : data.borderless === true || data.borderless === 1
              ? true
              : data.borderless === false || data.borderless === 0
                ? false
                : borderless,
          showSummaries: host.hasAttribute("data-summaries")
            ? showSummaries
            : data.showSummaries === false || data.showSummaries === 0
              ? false
              : data.showSummaries === true || data.showSummaries === 1
                ? true
                : showSummaries,
        };
        render(host, data, opts);
      })
      .catch(function () {
        var t = css(theme);
        var shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
        shadow.innerHTML = "";
        var style = el("style", { text: styles(t, borderless) });
        var root = el("div", { class: "wn" });
        root.appendChild(el("div", { class: "err", text: "Unable to load news." }));
        shadow.appendChild(style);
        shadow.appendChild(root);
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
  window.NwNews = api;
})();
