# CLAUDE.md

Marketing + waitlist site for **Lattica** ("Prediction Markets at 10X" — leverage,
borrowing, and lending on prediction markets). This is the `landing-page` service of
the wider Lattica codebase; sibling services keep their own `CLAUDE.md` files.

Deployed as a single **Cloudflare Worker** in front of static assets, with a
D1-backed waitlist API. **No framework, no bundler, no build step** — hand-written
HTML + vanilla JS + plain CSS served directly.

## Stack

- **Runtime:** Cloudflare Workers (ES-module Worker, `compatibility_date 2026-05-23`).
- **Package manager:** pnpm (`pnpm@11.3.0`, `pnpm-lock.yaml`). `pnpm-workspace.yaml`
  exists only for an `allowBuilds` list — this is not a multi-package workspace.
- **Deps:** `@sentry/cloudflare` (error monitoring), `html-rewriter-wasm` (runtime),
  and `wrangler` (dev).
- **Client-side CDN deps:** anime.js 3.2.2 (animation).
- **Data:** Cloudflare D1 (`lattica_waitlist`), binding `DB`.
- **Fonts:** Google Fonts — DM Sans (primary), Space Mono (mono). Dark theme.
- **No** TypeScript, ESLint, Biome, Prettier, or CI. A small Node test covers Worker
  startup without Sentry; deployment is manual.

## Layout

```
landing-page/
├── src/worker.js            # The entire Worker: waitlist API + per-route meta SSR
├── public/                  # Static assets (ASSETS binding)
│   ├── index.html           # Single page; JS swaps in-page "views"
│   ├── assets/css/styles.css        # ~1400 lines hand-written CSS, :root tokens
│   ├── assets/js/app.js             # View routing, form, interactive mocks
│   ├── assets/js/lattice-bg.js      # Animated <canvas> lattice background
│   ├── og-image.png, favicons, apple-touch-icon.png, lattica-privy-logo.png
│   ├── robots.txt, sitemap.xml
├── migrations/              # D1 waitlist schema + source provenance migration
├── test/worker.test.js      # Node test for the no-Sentry Worker path
├── wrangler.toml            # All config lives here (no tsconfig/vite/etc.)
├── package.json, pnpm-lock.yaml, pnpm-workspace.yaml
└── .env                     # Local dev secrets (gitignored)
```

## Architecture

The site is an **"SPA-lite":** one `index.html`, and `app.js` swaps hero "views"
(home / whitepapers / waitlist / careers) via History API `pushState` with
scramble-text animations — no page loads (`PATH_FOR_VIEW`/`VIEW_FOR_PATH`, `setView`).

The Worker does **light SSR of metadata only**. For known routes (`/`, `/whitepapers`,
`/waitlist`, `/careers`) it serves `index.html` but rewrites `<title>`, description,
canonical, and OG/Twitter meta per-route via `HTMLRewriter` (`ROUTES` map + `injectHtml`
in `worker.js`). All routes canonicalize to `https://lattica.finance/`.

Everything else falls through to the `ASSETS` static-asset binding. `run_worker_first`
is set for `/` and `/index.html` so the Worker can inject meta before those are served.

### Page sections (all in `index.html`)
- **Hero** — headline + "Join the waitlist" CTA; hosts the four swappable views.
- **How It Works** (MARGIN) — three interactive mock cards: LEVERAGE (long/short,
  leverage slider, live liquidation/fee calc), BORROW (LTV slider, epochs), LEND
  (supply APY, yield sparkline). Mock math lives in `app.js` (`leverageMock`, `borrowMock`).
- **Safety / Risk Engine** — 3-slide SVG slideshow ("Solvent, by design").
- **Bottom CTA**.

### Whitepapers
Papers are **externally hosted PDFs**, not in this repo:
- Paper I — "Unlocking Liquidity on Prediction Markets" → `docs.lattica.finance/unlocking-liquidity.pdf`
- Paper II — "Introducing Lattica" → `docs.lattica.finance/intro-lattica.pdf`

### Careers
No open roles listed. A single `.careers-message` ("Check back soon.") sits under the
"JOIN THE TEAM" eyebrow + "Careers" heading.

## Waitlist API — `POST /api/waitlist` (`handleWaitlist` in worker.js)

Layered defense, in order: method check (405) → **Origin allowlist** (403
`forbidden_origin`; from `ALLOWED_ORIGINS`, disabled if empty) → 2KB body guard (413)
→ JSON parse → email validation (regex, ≤254 chars, 400) → **per-IP rate limit**
(`WAITLIST_LIMITER`, 10 req/60s, 429)
→ `INSERT ... ON CONFLICT(email) DO NOTHING` into D1.

**IP privacy:** raw IP is used only for rate-limiting, then stored as
`HMAC-SHA256(ip, IP_SALT)` — never persisted or logged raw. Secrets, tokens, emails,
and full IPs are redacted from logs.

Client side (`app.js`): validates the email and POSTs `{ email }` on submit.

## Config, secrets, deploy

All config is in `wrangler.toml`:
- **Custom domains:** `lattica.finance`, `www.lattica.finance` (both `custom_domain`).
- **Bindings:** `ASSETS` (`./public`), `DB` (D1 `lattica_waitlist`), `WAITLIST_LIMITER`
  (rate limit), plus `[observability] enabled`.
- **Vars:** `ALLOWED_ORIGINS` (comma-separated; localhost dev ports + lattica.fi/.finance/.xyz + www).
- **Secrets** via `wrangler secret put`: `IP_SALT`, plus optional `SENTRY_DSN` to
  enable Sentry wrapping. `SENTRY_DEBUG_ENABLED=true` exposes the error-test route
  outside production.
- `.env` holds local dev values (`IP_SALT`).

Note: the monorepo convention is Vault (`vlt run --`) for secrets, but this service
uses `wrangler secret` / `.env` directly.

### Commands
```bash
pnpm dev              # wrangler dev (local)
pnpm dev:remote       # wrangler dev --remote
pnpm deploy           # wrangler deploy → custom domains (manual, no CI)
pnpm deploy:preview   # upload a version with a workers.dev preview URL
pnpm deploy:promote   # promote a previously uploaded version
pnpm test             # Node's built-in test runner

pnpm db:create        # create D1 lattica_waitlist
pnpm db:schema        # apply migrations (remote); :local for local
pnpm db:list / :count # query the waitlist; append :local for local DB
pnpm db:backup        # export remote D1 to backups/waitlist-YYYY-MM-DD.sql
pnpm db:reset:local   # wipe + re-migrate local D1 state
```

## Conventions & gotchas

- Match existing style: plain JS, no TypeScript, CSS custom properties in `:root`,
  minimal comments. There is no linter/formatter — keep it consistent by hand.
- Per-project code rules from global CLAUDE.md: never use `Any` types; keep in-code
  comments minimal; write docs only when asked; put md/docs under `.claude/`, not the root.
- `SITE_ORIGIN` / canonical is hardcoded to `https://lattica.finance` in `worker.js`.
- Adding a route means updating both the `ROUTES`/meta map in `worker.js` **and** the
  view logic in `app.js`, and usually `sitemap.xml` (currently a single URL).
- `og-image.png` is 1200×630; JSON-LD `Organization` schema + Twitter `@LatticaFinance`
  live in `index.html`'s head.
