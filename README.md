# widget.news — News widgets (Exa Search + Workers AI + Cloudflare)

Live news widgets for any site. User sets a topic → gets an embed. The **Worker** runs **Exa Search** on a schedule, writes short summaries with **Workers AI** (`llama-3.2-3b-instruct`), and stores feed JSON in R2.

**Page views fetch feeds from CDN** (`https://cdn.widget.news/f/{id}.json`) — Worker Cache API → R2 on miss. Worker handles API, cron, builder/admin, and presence beacons.

**Domain:** [https://widget.news](https://widget.news) · **Version:** 0.6.0

## Features

- **Builder** (`/`) — topic, appearance (title, theme, borderless, summaries), live preview
- **Dashboard** (`/admin`) — client access key or **root token**; list widgets, edit, pause, refresh, delete
- **Permanent session** — access key in `localStorage`; return visits open dashboard; **Sign out** clears it
- **New widget under same key** — `/?new=1` or dashboard “+ New widget” (no new token)
- **Embed** (`/embed.js`) — optional title (header or footer brand), borderless, summaries on/off
- **Presence + inactive** — beacon → `last_seen_at`; idle widgets stop Exa/AI until traffic returns
- **Cron** — mark inactive → refresh due **active** widgets (period + jitter + novelty)
- **i18n** — EN / RU / UK via URL path

## Auth model

| Token | Storage | Scope |
|-------|---------|--------|
| **`ROOT_TOKEN`** (Worker secret) | env only | Full system — every widget |
| **Client access key** | returned at create; browser `localStorage` (`wn_access_token`) | Settings/stats for all widgets bound to that key |

- Create mints a new key unless body includes existing `accessToken` (16–200 chars).
- API field: `accessToken` (alias `adminToken` still returned).
- `GET /api/widgets` → `{ scope: "root" \| "client", widgets: [...] }`.
- Deep link `/admin?token=…` persists the key, then cleans the query string.

### Session UX

```
first create → save key to localStorage
visit /       → redirect to /admin (if key present)
visit /admin  → auto-login
?new=1 on /   → builder without redirect; create reuses key
Sign out      → clear localStorage → show login / public builder
```

## Inactive widgets

CDN/edge cache means **R2 access logs cannot measure views**. Embed fires a cheap beacon instead:

```
embed mount → POST https://widget.news/api/v/{publicId}
  → Cache API throttle ~6h / colo
  → D1 last_seen_at (throttled)
  → if status=inactive → active + background refresh
```

| Status | Who sets | Cron refresh | Feed |
|--------|----------|--------------|------|
| `active` | default / user / resume | yes if due | served |
| `paused` | user | no | served |
| `inactive` | system (14d no presence, after 7d grace) | no | served (stale OK) |

Users set only `active` | `paused` via PATCH. Manual refresh also reactivates inactive.

## Refresh pipeline

```
cron (hourly)
  → mark idle active → inactive
  → due active widgets:
      lock → Exa Search → novelty → Workers AI → R2 feed → last_synced_at
```

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars
# EXA_API_KEY=...
# optional ROOT_TOKEN=...

rm -rf .wrangler/state/v3/d1 2>/dev/null
npm run db:local
npm run dev
# http://localhost:8787

npm run verify
```

## Deploy (production)

```bash
# 1) D1 migration (additive columns for 0.6 — ignore “duplicate column” if already applied)
npm run db:migrate:remote
# or full schema on empty DB:
# npm run db:remote

# 2) Secrets
npx wrangler secret put EXA_API_KEY
# optional operator root:
npx wrangler secret put ROOT_TOKEN

# 3) Deploy Worker + assets
npm run deploy

# 4) Optional: zone purge token for global feed cache bust after refresh
# npx wrangler secret put CF_ZONE_ID
# npx wrangler secret put CF_API_TOKEN
```

| Var / secret | Role |
|--------------|------|
| `PUBLIC_BASE_URL` | Site origin (`https://widget.news`) |
| `FEED_BASE_URL` | Feed CDN (`https://cdn.widget.news`) |
| `FEED_CAP` | Max items per feed (default 100) |
| `EXA_API_KEY` | Exa Search |
| `ROOT_TOKEN` | Optional full-system dashboard token |
| `CF_ZONE_ID` + `CF_API_TOKEN` | Optional cache purge |

Routes and bindings live in `wrangler.toml` (Worker domains `widget.news` + `cdn.widget.news`, D1, R2, AI, hourly cron).

### Feed CDN cache rule

`.json` is not in Cloudflare’s default cached extensions. Once per zone:

1. Caching → Cache Rules → Create  
2. `(http.host eq "cdn.widget.news")`  
3. Eligible for cache · Edge TTL 300s (or respect origin) · Browser TTL respect origin  

Helper: `npm run cdn:cache-rule` (needs zone API token).

## Embed

```html
<div
  data-wn="PUBLIC_ID"
  data-theme="site"
  data-limit="5"
  data-title="My news"
></div>
<script src="https://widget.news/embed.js" async></script>
```

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-wn` | — | Public widget id (required) |
| `data-theme` | `site` | `site` \| `light` \| `dark` |
| `data-limit` | `5` | Max stories |
| `data-title` | feed `title` / none | Section title; **empty = no header**, brand in footer |
| `data-borderless` | feed / off | `1` — no card frame |
| `data-summaries` | feed / on | `0` — hide snippets |
| `data-feed-base` | script origin | Override feed origin |
| `data-cache-bust` | — | Admin/preview only |
| `data-no-ping` | — | Skip presence beacon |

**Keep `embed.js` on widget.news** so beacons and inactive resume keep working.

### Themes

| Value | Behavior |
|-------|----------|
| `site` (default) | Inherit host font/color; transparent bg |
| `light` / `dark` | Isolated Google News–style palettes |

Legacy `auto` → stored/returned as `site`.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/widgets` | — | Create (+ optional `accessToken`) |
| GET | `/api/widgets` | Bearer / `?token=` | List (`ROOT_TOKEN` → all) |
| GET | `/api/widgets/:id` | Bearer / `?token=` | Config + embed |
| PATCH | `/api/widgets/:id` | Bearer | Update |
| DELETE | `/api/widgets/:id` | Bearer | Delete + purge feed |
| POST | `/api/widgets/:id/refresh` | Bearer | Search + AI → R2 |
| POST | `/api/widgets/:id/sync` | Bearer | Alias of `/refresh` |
| POST/GET | `/api/v/:publicId` | — | Presence (`204`) |
| GET | `cdn…/f/:id.json` | — | Feed JSON |
| GET | `/health` | — | Liveness (`version`) |

### Create / PATCH body

```json
{
  "query": "climate policy",
  "title": "Climate",
  "period": "1d",
  "numResults": 10,
  "widgetLimit": 5,
  "theme": "site",
  "borderless": false,
  "showSummaries": true,
  "status": "active",
  "accessToken": "optional-existing-client-key"
}
```

| Field | Notes |
|-------|--------|
| `query` | Required on create (3–2000 chars) |
| `title` | Optional header; empty hides chrome (`name` legacy write alias) |
| `period` | `1h` \| `6h` \| `1d` \| `7d` |
| `numResults` | 1–20 collect per search |
| `widgetLimit` | 1–50 shown |
| `theme` | `site` \| `light` \| `dark` (+ legacy `auto`) |
| `borderless` / `showSummaries` | Appearance |
| `status` | `active` \| `paused` only |
| `accessToken` | Create: bind to existing client key |

Response includes `title`, `accessToken` (create only), `lastSeenAt`, `embed`, `feedUrl`, `adminUrl`.

## Languages

| Locale | Paths |
|--------|--------|
| English | `/`, `/admin`, `/demo` |
| Russian | `/ru/…` |
| Ukrainian | `/uk/…` |

Strings: `public/i18n.js`. Embed chrome stays English on third-party hosts.

## Project layout

```
src/index.ts              fetch + scheduled
src/handlers/widgets.ts   CRUD + list + refresh
src/handlers/presence.ts  /api/v/:id beacon
src/lib/refresh.ts        search pipeline + inactive cron
src/lib/schedule.ts       due / jitter / inactive thresholds
src/lib/feed.ts           R2 + Cache API
src/db/schema.sql         full schema
src/db/migrate.sql        upgrades (0.6 columns)
public/auth.js            permanent access-key storage
public/embed.js           widget renderer + beacon
public/admin/             dashboard
tests/*.test.ts           unit + contract tests
```

## Tests

```bash
npm run verify   # tsc --noEmit && node tests
```

Covers schedule/inactive, feed presentation, embed snippets, auth/UI contracts, schema, worker routes, i18n keys.

## Brand

- **Name:** widget.news  
- **Accent:** `#E85D04`  
- **Type:** Fraunces + DM Sans  
