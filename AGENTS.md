# AGENTS.md

## Cursor Cloud specific instructions

`widget.news` is a single Cloudflare Workers app (TypeScript) served by `wrangler dev`. There is no separate frontend/backend — the Worker (`src/index.ts`) handles the API, cron, and serves the static builder/admin UI from `public/`. Standard commands live in `package.json` scripts and the README "Quick start"; prefer those.

Non-obvious caveats for running locally in this environment:

- **Dev server:** `npm run dev` starts the Worker on `http://localhost:8787`. There is no build step for development; `npm run deploy` is production-only (needs Cloudflare auth) — do not run it for local testing.
- **Local D1 must be initialized before first run.** Run `npm run db:local` once (creates the local SQLite-backed D1 under `.wrangler/`, which is gitignored and ephemeral per VM). Without it, widget CRUD fails. It uses `CREATE TABLE IF NOT EXISTS`, so re-running is safe. If the local DB gets into a bad state, `rm -rf .wrangler/state/v3/d1` then re-run `npm run db:local`.
- **`.dev.vars` is required** (gitignored; copy from `.dev.vars.example`). Set `ROOT_TOKEN=...` to exercise the full-system dashboard, and `PUBLIC_BASE_URL`/`FEED_BASE_URL` to `http://localhost:8787` for local links.
- **`EXA_API_KEY` and Workers AI are only needed for the refresh pipeline** (Exa Search + `llama-3.2-3b-instruct` summaries). Widget create/list/update/delete, auth, and the builder/admin UI all work without a real key. Newly created widgets show "No stories yet" until a valid `EXA_API_KEY` is set. Note the `AI` binding always hits **remote** Cloudflare resources even in local dev, so story generation additionally requires valid Cloudflare account auth.
- **Cron is not auto-triggered locally.** Manually fire it with `curl "http://localhost:8787/cdn-cgi/handler/scheduled"`.

Lint/test:

- `npm run check` — TypeScript typecheck (`tsc --noEmit`).
- `npm test` — unit/contract tests via `node --experimental-strip-types`.
- `npm run verify` — runs both.
