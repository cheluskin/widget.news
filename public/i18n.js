/**
 * widget.news i18n — EN default, RU + UK via URL path:
 *   /          → English
 *   /ru/…      → Russian
 *   /uk/…      → Ukrainian
 *   /en/…      → English (optional prefix)
 * Usage: data-i18n="key", data-lang-path="/admin"
 * Dynamic: WN_I18N.t("key"), WN_I18N.href("/admin")
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "wn_lang";
  var SUPPORTED = ["en", "ru", "uk"];

  var dict = {
    en: {
      meta_title: "widget.news — News widget for your website",
      meta_desc:
        "Add a news widget to your site in minutes. Choose a topic — we keep the feed updated with short summaries.",
      brand_tag: "news widgets for websites",
      brand_tag_admin: "admin",
      brand_tag_demo: "demo",
      nav_admin: "Dashboard",
      nav_demo: "Demo",
      nav_builder: "← Builder",
      nav_main: "Main",
      lang_label: "Language",

      home_eyebrow: "For any website",
      home_h1: "News widget in 3 steps",
      home_lead:
        "Pick a topic. We find stories, write short summaries, and give you code to paste on your site.",
      home_signed_in: "Creating with your saved access key.",
      btn_new_widget: "+ New widget",
      label_token_linked: "Added to your access key",
      token_linked_hint: "This widget is on your existing key — open the dashboard to manage all of them.",
      step_1: "Topic",
      step_2: "Create",
      step_3: "Paste code",
      examples_label: "Example topics",
      ex_ev: "EV news",
      ex_startups: "Startups",
      ex_ai: "AI",
      ex_climate: "Climate tech",
      ex_ev_q: "electric vehicles EV industry",
      ex_startups_q: "startup funding venture capital",
      ex_ai_q: "artificial intelligence AI product launches",
      ex_climate_q: "climate tech renewable energy",
      advanced_toggle: "More options",
      advanced_hint: "title, frequency, look",
      embed_hint: "Paste this into your HTML where the news should appear.",
      result_more: "More (feed link & refresh)",
      btn_copy_admin: "Copy admin link",

      form_create_h2: "Create a widget",
      label_name: "Title",
      label_title: "Title",
      optional: "(optional)",
      ph_name: "Shown above stories",
      ph_title: "Shown above stories",
      title_hint: "Leave empty to hide the header; brand link moves to the bottom.",
      label_borderless: "Borderless",
      borderless_hint: "No frame or rounded corners",
      label_show_summaries: "Show summaries",
      summaries_hint: "Short text under each headline",
      btn_reset_appearance: "Reset appearance",
      reset_appearance_ok: "Appearance reset — save to apply",
      label_query: "What news do you want?",
      ph_query: "e.g. electric cars, startup funding, local city news",
      label_period: "How often to update",
      period_1d: "Once a day (recommended)",
      period_6h: "Every 6 hours",
      period_7d: "Once a week",
      period_1h: "Every hour (heavier)",
      label_num_results: "Stories to collect",
      label_widget_limit: "Stories to show",
      label_theme: "Look",
      theme_site: "Site styles",
      theme_auto: "Site styles",
      theme_light: "Light",
      theme_dark: "Dark",
      cost_hint:
        "About {runs} updates per month. Once a day is a good default.",
      btn_create: "Create widget",
      btn_creating: "Creating…",

      result_h2: "Your widget is ready",
      status_created: "Loading the first stories…",
      status_ready: "News list is ready — copy the code below.",
      label_admin_token: "Save your access key",
      token_once:
        "Saved in this browser for 30 days. You’ll land in the dashboard next time — use Sign out to clear.",
      label_admin_page: "Admin link",
      label_feed_url: "News feed link",
      label_embed: "Code for your site",
      btn_copy: "Copy",
      btn_copied: "Copied",
      btn_copying: "Copying…",
      btn_copy_embed: "Copy code",
      btn_refresh: "Find new stories",
      btn_open_admin: "Open dashboard",
      preview_h2: "Live preview",
      btn_reload_preview: "Refresh",
      preview_empty: "Create a widget — the news list will appear here.",
      footer_tagline: "News widgets for websites",

      wait: "One moment…",
      done: "Done",
      sync_searching: "Looking for news…",
      sync_waiting: "Still loading… ({n}/{max})",
      sync_ready: "News list ready ({when}). Preview updated.",
      sync_timeout:
        "Still waiting. If the list is empty, try “Find new stories”.",
      sync_status_err: "Status: {msg}",
      sync_need_widget: "No active widget — create one first.",
      sync_create_first: "Create a widget first",
      sync_preview_ok: "Preview updated",
      sync_copy_fail: "Could not copy — select the field manually",
      sync_embed_fail: "Could not load the widget preview",
      err_generic: "Something went wrong",

      // Admin
      admin_meta_title: "Admin — widget.news",
      admin_meta_desc: "Manage your widget.news feed",
      admin_eyebrow: "Control panel",
      admin_h1: "Widget dashboard",
      admin_lead: "Sign in with your client access key (or root token). Manage settings and stats for your widgets.",
      admin_load_h2: "Sign in",
      admin_list_h2: "Your widgets",
      admin_list_meta: "Updated {when} · every {period}",
      admin_no_widgets: "No widgets for this access key",
      admin_need_token: "Enter your access key",
      admin_empty: "No widgets on this key yet.",
      admin_empty_hint: "Create one — it stays on the same access key.",
      btn_open_demo: "Open full-page demo",
      demo_need_id: "Paste a widget ID first",
      steps_aria: "How it works",
      admin_settings: "Feed settings",
      admin_appearance: "Appearance",
      admin_appearance_hint: "title, look, layout",
      admin_meta_line: "{status} · last update {when} · every {period} · last seen {seen}",
      ph_public_id: "from create or admin link",
      label_public_id: "Widget ID",
      label_admin_token_input: "Access key",
      btn_load: "Open",
      btn_loading: "Opening…",
      btn_logout: "Sign out",
      btn_back_list: "← All widgets",
      btn_save: "Save",
      btn_saving: "Saving…",
      btn_delete: "Delete",
      btn_deleting: "Deleting…",
      label_status: "Status",
      status_active: "Active",
      status_paused: "Paused",
      status_inactive: "Inactive",
      widget_default: "Widget",
      loaded_ok: "Widget loaded",
      saved_ok: "Saved",
      deleted_ok: "Deleted",
      confirm_delete: "Delete this widget and its feed?",
      load_first: "Open a widget first",
      footer_admin: "Dashboard · keep your access key secret",
      refresh_ok_n: "Found: {n} stories",
      refresh_fail: "Could not refresh: {reason}",

      // Demo
      demo_meta_title: "Demo — widget.news",
      demo_meta_desc: "Embed demo — widget.news",
      demo_eyebrow: "As on your site",
      demo_h1: "Widget demo",
      demo_lead:
        "Paste the public id of a widget you created to see how it looks when embedded on a page.",
      btn_show: "Show widget",
      footer_demo: "Try your widget here",
    },

    ru: {
      meta_title: "widget.news — Новостной виджет для сайта",
      meta_desc:
        "Виджет новостей для сайта за минуту. Выберите тему — лента обновляется сама, с короткими описаниями.",
      brand_tag: "новости для сайта",
      brand_tag_admin: "админ",
      brand_tag_demo: "демо",
      nav_admin: "Кабинет",
      nav_demo: "Демо",
      nav_builder: "← Конструктор",
      nav_main: "Меню",
      lang_label: "Язык",

      home_eyebrow: "Для любого сайта",
      home_h1: "Новостной виджет за 3 шага",
      home_lead:
        "Выберите тему. Мы найдём новости, напишем короткие описания и дадим код для вставки на сайт.",
      home_signed_in: "Создаём с вашим сохранённым ключом доступа.",
      btn_new_widget: "+ Новый виджет",
      label_token_linked: "Привязано к вашему ключу",
      token_linked_hint: "Виджет на вашем существующем ключе — откройте кабинет, чтобы управлять всеми.",
      step_1: "Тема",
      step_2: "Создать",
      step_3: "Вставить код",
      examples_label: "Примеры тем",
      ex_ev: "Электромобили",
      ex_startups: "Стартапы",
      ex_ai: "ИИ",
      ex_climate: "Климаттех",
      ex_ev_q: "электромобили рынок EV",
      ex_startups_q: "стартапы венчурные инвестиции",
      ex_ai_q: "искусственный интеллект запуск продуктов",
      ex_climate_q: "климатические технологии возобновляемая энергия",
      advanced_toggle: "Дополнительно",
      advanced_hint: "заголовок, частота, оформление",
      embed_hint: "Вставьте этот код в HTML туда, где должны быть новости.",
      result_more: "Ещё (ссылка на ленту и обновление)",
      btn_copy_admin: "Скопировать ссылку на кабинет",

      form_create_h2: "Создать виджет",
      label_name: "Заголовок",
      label_title: "Заголовок",
      optional: "(необязательно)",
      ph_name: "Над списком новостей",
      ph_title: "Над списком новостей",
      title_hint: "Пустой заголовок скрывает шапку; ссылка widget.news переносится вниз.",
      label_borderless: "Без рамки",
      borderless_hint: "Без обводки и скругления",
      label_show_summaries: "Показывать описания",
      summaries_hint: "Короткий текст под заголовком новости",
      btn_reset_appearance: "Сбросить оформление",
      reset_appearance_ok: "Оформление сброшено — сохраните, чтобы применить",
      label_query: "Какие новости нужны?",
      ph_query: "Например: электромобили, стартапы, новости города",
      label_period: "Как часто обновлять",
      period_1d: "Раз в день (рекомендуется)",
      period_6h: "Каждые 6 часов",
      period_7d: "Раз в неделю",
      period_1h: "Каждый час (нагрузка выше)",
      label_num_results: "Сколько новостей собирать",
      label_widget_limit: "Сколько показывать",
      label_theme: "Оформление",
      theme_site: "Стили сайта",
      theme_auto: "Стили сайта",
      theme_light: "Светлая",
      theme_dark: "Тёмная",
      cost_hint:
        "Около {runs} обновлений в месяц. Раз в день — удобный выбор.",
      btn_create: "Создать виджет",
      btn_creating: "Создаём…",

      result_h2: "Виджет готов",
      status_created: "Загружаем первые новости…",
      status_ready: "Список готов — скопируйте код ниже.",
      label_admin_token: "Сохраните ключ доступа",
      token_once:
        "Ключ сохранится в браузере на 30 дней. В следующий раз вы попадёте сразу в кабинет — «Выйти» сбросит его.",
      label_admin_page: "Ссылка на админку",
      label_feed_url: "Ссылка на ленту",
      label_embed: "Код для сайта",
      btn_copy: "Копировать",
      btn_copied: "Скопировано",
      btn_copying: "Копирую…",
      btn_copy_embed: "Копировать код",
      btn_refresh: "Найти новые",
      btn_open_admin: "Открыть кабинет",
      preview_h2: "Превью",
      btn_reload_preview: "Обновить",
      preview_empty: "Создайте виджет — список новостей появится здесь.",
      footer_tagline: "Новостные виджеты для сайтов",

      wait: "Секунду…",
      done: "Готово",
      sync_searching: "Ищем новости…",
      sync_waiting: "Ещё загружаем… ({n}/{max})",
      sync_ready: "Лента готова ({when}). Превью обновлено.",
      sync_timeout:
        "Пока нет ответа. Если список пуст — нажмите «Найти новые».",
      sync_status_err: "Статус: {msg}",
      sync_need_widget: "Нет активного виджета — сначала создайте его.",
      sync_create_first: "Сначала создайте виджет",
      sync_preview_ok: "Превью обновлено",
      sync_copy_fail: "Не удалось скопировать — выделите поле вручную",
      sync_embed_fail: "Не удалось загрузить превью виджета",
      err_generic: "Что-то пошло не так",

      admin_meta_title: "Кабинет — widget.news",
      admin_meta_desc: "Управление лентой widget.news",
      admin_eyebrow: "Панель управления",
      admin_h1: "Кабинет виджетов",
      admin_lead: "Войдите клиентским ключом доступа (или root-токеном). Настройки и статистика ваших виджетов.",
      admin_load_h2: "Вход",
      admin_list_h2: "Ваши виджеты",
      admin_list_meta: "Обновлён {when} · каждые {period}",
      admin_no_widgets: "Нет виджетов для этого ключа",
      admin_need_token: "Введите ключ доступа",
      admin_empty: "На этом ключе пока нет виджетов.",
      admin_empty_hint: "Создайте первый — он останется на том же ключе.",
      btn_open_demo: "Открыть демо на всю страницу",
      demo_need_id: "Сначала вставьте ID виджета",
      steps_aria: "Как это работает",
      admin_settings: "Настройки ленты",
      admin_appearance: "Оформление",
      admin_appearance_hint: "заголовок, вид, раскладка",
      admin_meta_line: "{status} · обновлено {when} · каждые {period} · показ {seen}",
      ph_public_id: "из создания или ссылки на админку",
      label_public_id: "ID виджета",
      label_admin_token_input: "Ключ доступа",
      btn_load: "Открыть",
      btn_loading: "Открываю…",
      btn_logout: "Выйти",
      btn_back_list: "← Все виджеты",
      btn_save: "Сохранить",
      btn_saving: "Сохраняю…",
      btn_delete: "Удалить",
      btn_deleting: "Удаляю…",
      label_status: "Статус",
      status_active: "Активен",
      status_paused: "Пауза",
      status_inactive: "Неактивен",
      widget_default: "Виджет",
      loaded_ok: "Виджет загружен",
      saved_ok: "Сохранено",
      deleted_ok: "Удалено",
      confirm_delete: "Удалить виджет и его ленту?",
      load_first: "Сначала откройте виджет",
      footer_admin: "Кабинет · храните ключ доступа в секрете",
      refresh_ok_n: "Найдено: {n} новостей",
      refresh_fail: "Не удалось обновить: {reason}",

      demo_meta_title: "Демо — widget.news",
      demo_meta_desc: "Как выглядит виджет на странице",
      demo_eyebrow: "Как на вашем сайте",
      demo_h1: "Демо виджета",
      demo_lead:
        "Вставьте public id созданного виджета, чтобы увидеть, как он выглядит на странице.",
      btn_show: "Показать виджет",
      footer_demo: "Попробуйте виджет здесь",
    },

    uk: {
      meta_title: "widget.news — Віджет новин для сайту",
      meta_desc:
        "Віджет новин для сайту за хвилину. Оберіть тему — стрічка оновлюється сама, з короткими описами.",
      brand_tag: "новини для сайту",
      brand_tag_admin: "адмін",
      brand_tag_demo: "демо",
      nav_admin: "Кабінет",
      nav_demo: "Демо",
      nav_builder: "← Конструктор",
      nav_main: "Меню",
      lang_label: "Мова",

      home_eyebrow: "Для будь-якого сайту",
      home_h1: "Віджет новин за 3 кроки",
      home_lead:
        "Оберіть тему. Ми знайдемо новини, напишемо короткі описи й дамо код для вставки на сайт.",
      home_signed_in: "Створюємо з вашим збереженим ключем доступу.",
      btn_new_widget: "+ Новий віджет",
      label_token_linked: "Прив’язано до вашого ключа",
      token_linked_hint: "Віджет на вашому існуючому ключі — відкрийте кабінет, щоб керувати всіма.",
      step_1: "Тема",
      step_2: "Створити",
      step_3: "Вставити код",
      examples_label: "Приклади тем",
      ex_ev: "Електромобілі",
      ex_startups: "Стартапи",
      ex_ai: "ШІ",
      ex_climate: "Кліматтех",
      ex_ev_q: "електромобілі ринок EV",
      ex_startups_q: "стартапи венчурні інвестиції",
      ex_ai_q: "штучний інтелект запуск продуктів",
      ex_climate_q: "кліматичні технології відновлювана енергія",
      advanced_toggle: "Додатково",
      advanced_hint: "заголовок, частота, оформлення",
      embed_hint: "Вставте цей код у HTML туди, де мають бути новини.",
      result_more: "Ще (посилання на стрічку й оновлення)",
      btn_copy_admin: "Скопіювати посилання на кабінет",

      form_create_h2: "Створити віджет",
      label_name: "Заголовок",
      label_title: "Заголовок",
      optional: "(необов’язково)",
      ph_name: "Над списком новин",
      ph_title: "Над списком новин",
      title_hint: "Порожній заголовок ховає шапку; посилання widget.news переходить вниз.",
      label_borderless: "Без рамки",
      borderless_hint: "Без обводки та скруглення",
      label_show_summaries: "Показувати описи",
      summaries_hint: "Короткий текст під заголовком новини",
      btn_reset_appearance: "Скинути оформлення",
      reset_appearance_ok: "Оформлення скинуто — збережіть, щоб застосувати",
      label_query: "Які новини потрібні?",
      ph_query: "Наприклад: електромобілі, стартапи, новини міста",
      label_period: "Як часто оновлювати",
      period_1d: "Раз на день (рекомендовано)",
      period_6h: "Кожні 6 годин",
      period_7d: "Раз на тиждень",
      period_1h: "Щогодини (навантаження вище)",
      label_num_results: "Скільки новин збирати",
      label_widget_limit: "Скільки показувати",
      label_theme: "Оформлення",
      theme_site: "Стилі сайту",
      theme_auto: "Стилі сайту",
      theme_light: "Світла",
      theme_dark: "Темна",
      cost_hint:
        "Близько {runs} оновлень на місяць. Раз на день — зручний вибір.",
      btn_create: "Створити віджет",
      btn_creating: "Створюємо…",

      result_h2: "Віджет готовий",
      status_created: "Завантажуємо перші новини…",
      status_ready: "Список готовий — скопіюйте код нижче.",
      label_admin_token: "Збережіть ключ доступу",
      token_once:
        "Ключ збережеться в браузері на 30 днів. Наступного разу ви одразу потрапите в кабінет — «Вийти» скине його.",
      label_admin_page: "Посилання на адмінку",
      label_feed_url: "Посилання на стрічку",
      label_embed: "Код для сайту",
      btn_copy: "Копіювати",
      btn_copied: "Скопійовано",
      btn_copying: "Копіюю…",
      btn_copy_embed: "Копіювати код",
      btn_refresh: "Знайти нові",
      btn_open_admin: "Відкрити кабінет",
      preview_h2: "Прев’ю",
      btn_reload_preview: "Оновити",
      preview_empty: "Створіть віджет — список новин з’явиться тут.",
      footer_tagline: "Віджети новин для сайтів",

      wait: "Секунду…",
      done: "Готово",
      sync_searching: "Шукаємо новини…",
      sync_waiting: "Ще завантажуємо… ({n}/{max})",
      sync_ready: "Стрічка готова ({when}). Прев’ю оновлено.",
      sync_timeout:
        "Поки немає відповіді. Якщо список порожній — натисніть «Знайти нові».",
      sync_status_err: "Статус: {msg}",
      sync_need_widget: "Немає активного віджета — спочатку створіть його.",
      sync_create_first: "Спочатку створіть віджет",
      sync_preview_ok: "Прев’ю оновлено",
      sync_copy_fail: "Не вдалося скопіювати — виділіть поле вручну",
      sync_embed_fail: "Не вдалося завантажити прев’ю віджета",
      err_generic: "Щось пішло не так",

      admin_meta_title: "Кабінет — widget.news",
      admin_meta_desc: "Керування стрічкою widget.news",
      admin_eyebrow: "Панель керування",
      admin_h1: "Кабінет віджетів",
      admin_lead: "Увійдіть клієнтським ключем доступу (або root-токеном). Налаштування й статистика ваших віджетів.",
      admin_load_h2: "Вхід",
      admin_list_h2: "Ваші віджети",
      admin_list_meta: "Оновлено {when} · кожні {period}",
      admin_no_widgets: "Немає віджетів для цього ключа",
      admin_need_token: "Введіть ключ доступу",
      admin_empty: "На цьому ключі ще немає віджетів.",
      admin_empty_hint: "Створіть перший — він залишиться на тому ж ключі.",
      btn_open_demo: "Відкрити демо на всю сторінку",
      demo_need_id: "Спочатку вставте ID віджета",
      steps_aria: "Як це працює",
      admin_settings: "Налаштування стрічки",
      admin_appearance: "Оформлення",
      admin_appearance_hint: "заголовок, вигляд, макет",
      admin_meta_line: "{status} · оновлено {when} · кожні {period} · показ {seen}",
      ph_public_id: "зі створення або посилання на адмінку",
      label_public_id: "ID віджета",
      label_admin_token_input: "Ключ доступу",
      btn_load: "Відкрити",
      btn_loading: "Відкриваю…",
      btn_logout: "Вийти",
      btn_back_list: "← Усі віджети",
      btn_save: "Зберегти",
      btn_saving: "Зберігаю…",
      btn_delete: "Видалити",
      btn_deleting: "Видаляю…",
      label_status: "Статус",
      status_active: "Активний",
      status_paused: "Пауза",
      status_inactive: "Неактивний",
      widget_default: "Віджет",
      loaded_ok: "Віджет завантажено",
      saved_ok: "Збережено",
      deleted_ok: "Видалено",
      confirm_delete: "Видалити віджет і його стрічку?",
      load_first: "Спочатку відкрийте віджет",
      footer_admin: "Кабінет · зберігайте ключ доступу в секреті",
      refresh_ok_n: "Знайдено: {n} новин",
      refresh_fail: "Не вдалося оновити: {reason}",

      demo_meta_title: "Демо — widget.news",
      demo_meta_desc: "Як виглядає віджет на сторінці",
      demo_eyebrow: "Як на вашому сайті",
      demo_h1: "Демо віджета",
      demo_lead:
        "Вставте public id створеного віджета, щоб побачити, як він виглядає на сторінці.",
      btn_show: "Показати віджет",
      footer_demo: "Спробуйте віджет тут",
    },
  };

  function pathWithoutLang(pathname) {
    var p = pathname || "/";
    var m = p.match(/^\/(en|ru|uk)(?=\/|$)/);
    if (m) {
      var rest = p.slice(m[0].length) || "/";
      return rest.charAt(0) === "/" ? rest : "/" + rest;
    }
    return p.charAt(0) === "/" ? p : "/" + p;
  }

  /** Locale prefix for links: "" for en, "/ru" or "/uk" otherwise. */
  function prefix(forLang) {
    var l = forLang || lang;
    return l === "en" ? "" : "/" + l;
  }

  /** Build localized href for a site path like "/admin" or "/". */
  function href(path, forLang) {
    var bare = pathWithoutLang(path || "/");
    if (bare !== "/" && bare.slice(-1) === "/") bare = bare.slice(0, -1);
    var pre = prefix(forLang);
    if (bare === "/" || bare === "") return pre ? pre + "/" : "/";
    // Directory pages need trailing slash (assets auto-trailing-slash).
    // Without it /ru/admin → 307 /admin/ drops locale → i18n redirects → loop.
    var last = bare.split("/").pop() || "";
    if (last.indexOf(".") === -1) return pre + bare + "/";
    return pre + bare;
  }

  function detectFromPath() {
    try {
      var m = location.pathname.match(/^\/(en|ru|uk)(?=\/|$)/);
      if (m) return m[1];
    } catch (e) {}
    return null;
  }

  function detect() {
    var fromPath = detectFromPath();
    if (fromPath) return fromPath;
    // Root path: prefer saved preference or browser, then stay on / (en URL)
    try {
      var s = localStorage.getItem(STORAGE_KEY);
      if (s && SUPPORTED.indexOf(s) >= 0 && s !== "en") {
        // Redirect once to preferred locale path (only on bare English paths)
        return s;
      }
    } catch (e2) {}
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
    nav = String(nav).toLowerCase();
    if (nav.indexOf("uk") === 0 || nav.indexOf("ua") === 0) return "uk";
    if (nav.indexOf("ru") === 0) return "ru";
    return "en";
  }

  var lang = detect();

  function t(key, vars) {
    var table = dict[lang] || dict.en;
    var s = table[key] != null ? table[key] : dict.en[key];
    if (s == null) return key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  /** Navigate to the same page under another locale path. */
  function setLang(next) {
    if (SUPPORTED.indexOf(next) < 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {}
    var bare = pathWithoutLang(location.pathname);
    var target = href(bare, next) + location.search + location.hash;
    if (target !== location.pathname + location.search + location.hash) {
      location.assign(target);
      return;
    }
    lang = next;
    apply(document);
  }

  function applyLangLinks(root) {
    root.querySelectorAll("[data-lang-path]").forEach(function (el) {
      var path = el.getAttribute("data-lang-path") || "/";
      var h = href(path);
      if (el.tagName === "A") el.setAttribute("href", h);
    });
  }

  function apply(root) {
    root = root || document;
    document.documentElement.lang = lang === "uk" ? "uk" : lang;

    var titleKey = document.body && document.body.getAttribute("data-i18n-title");
    if (titleKey) document.title = t(titleKey);
    var desc = document.querySelector('meta[name="description"]');
    var descKey = document.body && document.body.getAttribute("data-i18n-desc");
    if (desc && descKey) desc.setAttribute("content", t(descKey));

    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!key) return;
      var val = t(key);
      if (el.hasAttribute("data-i18n-html")) el.innerHTML = val;
      else el.textContent = val;
    });

    root.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });

    root.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });

    root.querySelectorAll("[data-i18n-title-attr]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title-attr")));
    });

    root.querySelectorAll("[data-i18n-example]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-example");
      if (k) el.setAttribute("data-example", t(k));
    });

    applyLangLinks(root);

    root.querySelectorAll("[data-lang]").forEach(function (btn) {
      var l = btn.getAttribute("data-lang");
      btn.classList.toggle("is-active", l === lang);
      btn.setAttribute("aria-pressed", l === lang ? "true" : "false");
    });
  }

  function mountSwitcher(container) {
    if (!container) return;
    container.innerHTML = "";
    container.classList.add("lang-switch");
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", t("lang_label"));
    SUPPORTED.forEach(function (l) {
      var b = document.createElement("a");
      b.className = "lang-btn" + (l === lang ? " is-active" : "");
      b.setAttribute("data-lang", l);
      b.setAttribute("aria-pressed", l === lang ? "true" : "false");
      b.setAttribute("href", href(pathWithoutLang(location.pathname), l) + location.search);
      b.textContent = l.toUpperCase();
      b.addEventListener("click", function (ev) {
        // keep SPA-less full navigation; still persist preference
        try {
          localStorage.setItem(STORAGE_KEY, l);
        } catch (e) {}
      });
      container.appendChild(b);
    });
  }

  function maybeRedirectToPreferred() {
    // If user is on bare / (no locale) but prefers ru/uk, send them to /ru or /uk once
    if (detectFromPath()) return;
    if (lang === "en") return;
    var bare = pathWithoutLang(location.pathname);
    var target = href(bare, lang) + location.search + location.hash;
    if (target !== location.pathname + location.search + location.hash) {
      location.replace(target);
    }
  }

  function boot() {
    maybeRedirectToPreferred();
    var host = document.getElementById("lang-switch");
    if (host) mountSwitcher(host);
    apply(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  global.WN_I18N = {
    t: t,
    get lang() {
      return lang;
    },
    setLang: setLang,
    apply: apply,
    href: href,
    prefix: prefix,
    pathWithoutLang: pathWithoutLang,
    supported: SUPPORTED.slice(),
  };
})(typeof window !== "undefined" ? window : globalThis);
