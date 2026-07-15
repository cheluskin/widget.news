# widget.news — News widgets (Exa Search + Workers AI + Cloudflare)

Live news widgets for any site. User sets a topic → gets an embed. The **Worker** runs **Exa Search** on a schedule, writes short summaries with **Workers AI** (`llama-3.2-3b-instruct`), and stores feed JSON in R2. Page views hit the feed (R2 + edge cache), not Exa.

**Domain:** [https://widget.news](https://widget.news)

## Features

- Builder UI (`/`) — create, cost hint, preview
- Admin UI (`/admin?id=&token=`) — edit, pause, refresh, delete
- Embed (`/embed.js`) — shadow DOM, light/dark/auto, brand badge
- Cron — period + jitter; date window + novelty (last 5 runs)
- Summaries via Workers AI; search via Exa only

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars
# EXA_API_KEY=...

rm -rf .wrangler/state/v3/d1 2>/dev/null; npm run db:local
npm run dev
# http://localhost:8787
```

```bash
npm run verify
```

## Deploy

1. D1 / R2 already bound in `wrangler.toml` (or create new and paste ids)
2. `npm run db:remote` if schema changed
3. `npx wrangler secret put EXA_API_KEY`
4. Vars:

   | Var | Example |
   |-----|---------|
   | `PUBLIC_BASE_URL` | `https://widget.news` |
   | `FEED_BASE_URL` | `https://widget.news` or `https://cdn.widget.news` |

5. Custom domain `widget.news` on the Worker (see `wrangler.toml` routes)
6. `npx wrangler deploy`

## Embed

```html
<div data-wn="PUBLIC_ID" data-theme="auto" data-limit="5"></div>
<script src="https://widget.news/embed.js" async></script>
```

Legacy: `data-nw` and `window.NwNews` still work. Prefer `data-wn` / `window.WidgetNews`.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/widgets` | — | Create + background first search |
| GET | `/api/widgets/:id` | Bearer / `?token=` | Config + embed |
| PATCH | `/api/widgets/:id` | Bearer | Update config |
| DELETE | `/api/widgets/:id` | Bearer | Delete widget + feed |
| POST | `/api/widgets/:id/refresh` | Bearer | Search + AI → R2 |
| POST | `/api/widgets/:id/sync` | Bearer | Same as refresh |
| GET | `/f/:publicId.json` | — | Feed JSON |
| GET | `/health` | — | Liveness |

## Brand

- **Name:** widget.news  
- **Accent:** signal orange `#E85D04`  
- **Ink / paper:** editorial navy + warm paper  
- **Type:** Fraunces (display) + DM Sans (UI)

## Project layout

```
src/index.ts           fetch + scheduled
src/handlers/          widgets
src/lib/               exa, summarize, novelty, period, feed, ingest
public/                builder, admin, embed, demo
```
