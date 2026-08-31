# Stockt Pantry

Self-hosted pantry inventory and recipe book for a household, with a real answer to
*"what can I cook right now?"*

Track what's on the shelf as `(ingredient, quantity, unit)`, keep recipes alongside it,
and let the app cross-reference the two: every recipe is marked **makeable**, **short**,
**missing**, or **can't verify**, at whatever serving count you ask for. Pick a recipe
you can't make yet and it produces a shopping list of exactly the shortfalls.

One deployment serves many independent households, and each household's pantry, recipes,
and ingredient catalog are isolated from every other one.

## Features

- **Pantry inventory** — per-household list of ingredient / quantity / unit. No
  expiration dates, locations, or cost tracking; minimal fields on purpose.
- **Recipes** — name, base servings, ordered steps, and an ingredient list tied to a
  canonical per-household ingredient catalog (never free text).
- **"What can I make"** — quantity-aware matching, not presence-only. Free conversion
  within mass (g/oz/lb) and within volume (mL/L/cup/tbsp/tsp), plus count units.
  Mass↔volume needs the ingredient's density; without it the line is reported as
  **"can't verify"** rather than silently assumed present or absent.
- **Recipe scaling** — view a recipe at any serving count; required quantities and
  makeable status scale with it.
- **Shopping list** — for a recipe at its current scale, every missing or short line with
  the quantity still needed, in the recipe's own unit. Read-only: checking something off
  never writes back to the pantry.
- **Recipe import from a URL** — fetches the page, extracts its `schema.org/Recipe`
  JSON-LD, parses each ingredient line, and hands you a review-and-confirm screen where
  you map lines to catalog ingredients. Nothing is persisted until you confirm.
- **Invite-only signup** — creating a household needs an operator-held token; joining an
  existing one needs a single-use, time-limited invite link. No public registration, no
  email sending.

Deliberately out of scope for v1: public signup, barcode scanning, nutrition data, meal
planning, image uploads, HTML-scraping fallback for import, and shopping-list write-back
to the pantry. See [`SPEC.md`](SPEC.md) §2 for the full list and the reasoning.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript on Node 26, Drizzle ORM against
Postgres 17, Vitest for tests. Auth is email + password with server-side sessions in
HTTP-only cookies, implemented directly on `node:crypto` — see
[`CLAUDE.md`](CLAUDE.md) for why there's no auth library.

## Quick start (Docker Compose)

Everything runs from the compose file: Postgres, a one-shot migration job, and the app.

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD and HOUSEHOLD_SIGNUP_TOKEN — there are no defaults for either.
#   openssl rand -base64 32
docker compose up
```

The app listens on <http://127.0.0.1:3000> (loopback only — put a TLS-terminating
reverse proxy in front before exposing it further). Visit `/signup`, enter the signup
token, and create your household. From `/household` you can generate invite links for
other members.

One caveat when browsing the compose stack directly: the image sets
`NODE_ENV=production`, so the session cookie is `Secure` and `__Host-` prefixed, and a
browser drops it over plain `http://127.0.0.1:3000` — login will appear to do nothing.
That's the safe default; terminate TLS in front rather than turning it off. For poking at
the UI without a proxy, use the dev server below.

## Local development

```bash
npm install
docker compose up -d db      # Postgres only; needs POSTGRES_PASSWORD in .env
npm run db:migrate           # apply checked-in Drizzle migrations
npm run dev                  # http://localhost:3000
```

Set `DATABASE_URL` in `.env` to point at the published port, e.g.
`postgres://stockt:<password>@127.0.0.1:5432/stockt`. Leave `SESSION_COOKIE_SECURE`
unset locally.

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Test (all) | `npm test` |
| Test (pure logic only, no Docker) | `npm test -- --project=unit` |
| Test (DB integration only) | `npm test -- --project=db` |
| Test (single file) | `npm test -- src/lib/matching/match.test.ts` |
| Test (watch) | `npm run test:watch` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Generate a migration | `npm run db:generate` |
| Apply migrations | `npm run db:migrate` |
| Stop the throwaway test database | `npm run db:test:down` |

The Vitest suite is split into two projects. `unit` is pure logic and needs nothing
running. `db` starts a throwaway Postgres from `docker-compose.test.yml` and runs the
migrations against it — a filtered run only starts Docker if it actually matches a `db`
test, so single-file iteration stays fast. Tests that need Postgres are named
`*.db.test.ts`; that suffix, not the directory, is what routes them.

## Configuration

All configuration is environment variables; [`.env.example`](.env.example) documents each
one (names only — never put a real value there).

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string for the app and for `drizzle-kit`. Append `?sslmode=require` for a remote database. |
| `HOUSEHOLD_SIGNUP_TOKEN` | yes | Shared secret gating *household creation*. **Fails closed** — unset means signup is disabled, not unguarded. Joining an existing household ignores it and uses an invite instead. |
| `SESSION_COOKIE_SECURE` | no | Set to `true` to force a `Secure` session cookie when the app is served over HTTP behind a TLS-terminating proxy. Flipping it signs everyone out once. |
| `POSTGRES_PASSWORD` | yes (compose) | Password for the `db` service. No default, deliberately. |
| `POSTGRES_USER` / `POSTGRES_DB` / `POSTGRES_PORT` | no | Default to `stockt` / `stockt` / `5432`. |
| `APP_PORT` | no | Host port for the app service (default `3000`). |
| `TEST_DATABASE_URL` | no | Points the integration suite at an existing database. It `TRUNCATE`s before every test — leave it unset and let the suite start its own throwaway Postgres. |

## Layout

```
src/
  app/         Next.js App Router pages and server actions
  db/          Drizzle schema, migrations client, and tenant-scoped queries
    queries/   every query is scoped by household at this layer
  lib/
    auth/      password hashing, tokens, cookies, session flows
    import/    URL fetch (SSRF-guarded), JSON-LD extraction, ingredient-line parsing
    matching/  units, conversion, and the makeable / short / missing / unresolved engine
    pantry/    pantry entry validation and services
    recipes/   recipe form and import-draft logic
  packaging/   guard tests for the Docker/compose build
drizzle/       checked-in SQL migrations
docs/specs/    archive of shipped specs (decision history)
```

## Design invariants

Two things in this codebase are not negotiable, and both have tests standing guard:

- **Tenant isolation.** Every query touching `pantry_item`, `recipe`, `ingredient`, or
  `recipe_ingredient` is scoped by the session's `household_id` at the query layer — via
  a branded `HouseholdScope` that a bare string can't be substituted for — not filtered
  in the UI. Postgres backs this up with composite foreign keys on `(household_id, id)`,
  so a wrong query still can't store a row pointing at another household's data.
  `src/db/tenant-isolation.db.test.ts` exercises the whole surface.
- **SSRF mitigation on recipe import.** The fetcher resolves the host and rejects
  private/loopback/link-local ranges before connecting, allows only http/https,
  revalidates every redirect hop, and enforces a timeout and response size cap. Treat any
  change to it as security-sensitive.

Contributors (human or otherwise) should read [`CLAUDE.md`](CLAUDE.md) before changing
auth, the query layer, the importer, or the packaging — it records the trade-offs behind
each and the failure modes that have actually bitten.

## License

MIT — see [`LICENSE`](LICENSE).
