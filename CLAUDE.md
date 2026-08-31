# Stockt-Pantry

<!-- Target: under 200 lines. If it grows past that, move topics into
     .claude/rules/<topic>.md with `paths:` frontmatter so they load on demand.
     HTML comments like this one are stripped before Claude sees the file. -->

This app tracks the pantry inventory of a household and stores recipes. The app
will tell you what recipes you can make with the current pantry inventory. The user can
also select a recipe and if items are missing from the recipe list, it will generate a
shopping list of items needed. 

## Commands

<!-- The highest-value lines in this file. Claude cannot guess these. -->

Next.js 16 (App Router) + React 19 + TypeScript, tests on Vitest. Node 26, npm.

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev server | `npm run dev` (http://localhost:3000) |
| Test (all) | `npm test` |
| Test (single file) | `npm test -- src/lib/matching/match.test.ts` |
| Test (pure logic only, no Docker) | `npm test -- --project=unit` |
| Test (DB integration only) | `npm test -- --project=db` |
| Test (watch) | `npm run test:watch` |
| Lint | `npm run lint` (`eslint .`) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Build | `npm run build` |
| Production server | `npm start` |
| Dev database | `docker compose up -d db` (needs `POSTGRES_PASSWORD` in `.env`) |
| Local stack (app + Postgres) | `docker compose up` (needs `POSTGRES_PASSWORD` in `.env`; app on http://localhost:3000) |
| DB migrations (Drizzle) | `npm run db:generate` then `npm run db:migrate` |
| Stop the test database | `npm run db:test:down` |

Prefer running a single test file over the whole suite while iterating.

The Vitest suite is split into two projects. `unit` is the pure logic and needs nothing
installed; `db` starts a throwaway Postgres from `docker-compose.test.yml` and runs the
migrations against it. A filtered run only starts Docker if it actually matches a `db`
test, so single-file iteration on the matching engine stays fast.

## Architecture

<!-- Only what cannot be derived by reading the code: boundaries, invariants,
     and decisions with rationale. Not a directory listing. -->

- Stack: Next.js (App Router) + TypeScript, Drizzle ORM against Postgres, email+password
  sessions in HTTP-only cookies. Packaged as Docker Compose (`app` + `db` services).
- Packaging: `next.config.ts` sets `output: "standalone"`, and the Dockerfile's `runtime`
  stage copies only that — no `npm install` in the final image, so `drizzle-kit` (a
  devDependency) is deliberately absent from it. Migrations therefore run as a **one-shot
  `migrate` compose service** built from the `migrator` stage, which `app` waits on via
  `service_completed_successfully`. Do not move migrations into the app's own startup:
  two replicas would race on the same schema, and a bad migration would present as a
  crash-looping web server instead of a job that exited non-zero. `src/packaging/`
  holds guard tests for the parts of this that have actually broken.
- **Auth has no library, deliberately.** SPEC.md §3 names "Lucia or Auth.js"; Lucia is
  deprecated (its docs now point at implementing sessions directly) and Auth.js's
  credentials provider only supports JWT sessions, which contradicts the server-side
  sessions SPEC.md §3/§4 require. So: `node:crypto` scrypt at OWASP parameters
  (`src/lib/auth/password.ts`) and a `session` table keyed by the SHA-256 of the cookie
  token. Do not swap in a hashing or session library without re-reading that trade-off.
- Auth layering: `src/lib/auth/{password,token,cookie,credentials,signup-token}.ts` are
  pure and unit-tested; `service.ts` holds the flows and takes an explicit `now` so
  expiry is testable without faking the clock; `session.ts` is the only place the cookie
  is read or written. Identity-layer queries that cannot take a scope — signup, login,
  invite redemption, session lookup — live in `src/db/queries/auth.ts` and are keyed by
  something already secret, never by a caller-supplied household id.
- Creating a household is gated on `HOUSEHOLD_SIGNUP_TOKEN` (SPEC.md §2 rules out public
  signup but still wants many households per deployment). The check **fails closed**:
  unset means signup is disabled, not unguarded. Joining an existing household ignores it
  and goes through a single-use invite.
- Ingredient catalog is scoped **per household**, not global — two households can name
  ingredients independently; there is no shared/cross-household catalog table.
- Matching engine (recipe-makeable / shopping-list logic) is pure logic with no DB
  dependency — keep it that way so it stays exhaustively unit-testable (see SPEC.md §5).
- Recipe import is a two-phase flow: fetch+parse (server-side, nothing persisted) →
  review-and-confirm screen (user maps lines to catalog ingredients) → save. Never
  persist recipe/ingredient rows from a fetch before explicit user confirmation.
- **Invariant — tenant isolation**: every query touching `pantry_item`, `recipe`,
  `ingredient`, or `recipe_ingredient` must be scoped by the session's `household_id` at
  the query layer, not filtered client-side or in the UI only. This is the one invariant
  that must never be violated (SPEC.md §4). Mechanically: tenant queries live in
  `src/db/queries/`, take a branded `HouseholdScope` (`src/db/scope.ts`) as their first
  argument, and build their `where` clause with `ownedBy(scope, table, ...)` — a bare
  string cannot be passed where a scope is expected. `src/db/tenant-isolation.test.ts`
  runs the whole surface against a real Postgres. Add a query, add it there.
- Cross-tenant writes are additionally blocked at the schema level: `pantry_item` and
  `recipe_ingredient` reference `ingredient`/`recipe` by a **composite** foreign key on
  `(household_id, id)`, so Postgres refuses to store a row pointing at another
  household's data even if the query layer is wrong. `recipe_ingredient` carries its own
  `household_id` for the same reason — do not "normalise" it away.
- **Invariant — SSRF mitigation on recipe import fetch**: the URL fetcher (SPEC.md §4)
  must resolve the host and reject private/loopback/link-local ranges before connecting,
  allow only http/https, revalidate every redirect hop against the same check (or
  disable redirects), and enforce a timeout + response size cap. Treat any change to the
  fetcher as security-sensitive.

## Conventions

- Quantities are always `(value, unit)` pairs tied to a canonical `ingredient` catalog
  entry — never free-text ingredient names in pantry/recipe rows. Free text only exists
  transiently during import parsing, before the review-and-confirm step resolves it.
- Unit conversion: mass↔mass, volume↔volume, and count are always resolvable; mass↔volume
  requires `ingredient.density_g_per_ml` and must produce a distinct **"unresolved" /
  "can't verify"** status when density is absent — never silently treat it as
  missing or as satisfied.
- Zero/negative quantities are rejected at the data-entry layer, not in the matching
  logic (matching logic assumes valid input).

## Workflow

- Work in plan mode for anything touching more than two files.
- Every change ships with a test. Run the relevant tests before calling a task done,
  and show the output rather than asserting success.
- Never commit directly to `main`; open a PR.

## Guardrails

<!-- Reminders only. Enforcement lives in .claude/settings.json and .claude/hooks/. -->

- IMPORTANT: never read, print, or copy the contents of `.env*`, `secrets/**`, or any
  private key. Read `.env.example` for variable *names* only.
- Do not add a dependency without asking first. Justify it and check its transitive
  footprint.
- Do not edit `.github/workflows/**` or `.claude/**` without an explicit request.

## Gotchas

<!-- Append here whenever a correction has to be given twice. Over time this becomes
     the highest-signal part of the file. -->

- `CHECK (x > 0)` on a `double precision` column does **not** reject `NaN` or `Infinity`.
  Postgres sorts `NaN` above every other float, so `'NaN'::float8 > 0` is true, and
  postgres.js passes JS `NaN`/`Infinity` straight through. Quantity and density checks
  must be `x > 0 AND x < 'Infinity'::float8` (see `positiveFinite` in `src/db/schema.ts`),
  and writes go through `src/db/validate.ts` first. A stored `Infinity` quantity makes a
  recipe report *makeable* off an empty pantry; a stored `NaN` density slips past the
  `<= 0` guard in `convert` and returns `NaN` instead of "can't verify".
- Never log a Drizzle error's `.message`. `DrizzleQueryError` formats as
  `Failed query: <sql>\nparams: <bound values>`, and that string now contains password
  hashes, invite token hashes, and whole recipes — which SPEC.md §4 keeps out of the logs
  just as firmly. Log `error.cause.code` and `.constraint_name` instead;
  `tenant-isolation.db.test.ts` shows the unwrapping. **Rethrowing one counts as logging
  it** — Next's default error handler prints whatever escapes, cause chain included. So
  `src/db/redact.ts` converts every driver error into a fresh `Error` carrying only the
  SQLSTATE and constraint name, and drops the original rather than attaching it as
  `cause`; `queries/auth.ts`, `queries/recipes.ts` and `queries/ingredients.ts` route
  through it. Any new query that binds a secret or tenant content must do the same.
- Tests that need Postgres are named `*.db.test.ts`. That suffix, not the directory, is
  what routes a file to the Docker-backed Vitest project — `src/db/validate.test.ts` is
  pure and must stay in the fast one.
- `unsafeHouseholdScopeFromId()` validates the *shape* of a household id, not that the
  caller is entitled to it. Passing a route parameter to it typechecks and quietly hands
  over another household's data. Use `scopeForSession(session)` — or, in a page or
  action, `requireScope()` from `src/lib/auth/session.ts`. `unsafeHouseholdScopeFromId`
  should keep exactly two callers: `scopeForSession`, and tests.

- No fallback HTML scraping for recipe import — if a page has no `schema.org/Recipe`
  JSON-LD block, the import fails explicitly. Don't add scraping heuristics; this was a
  deliberate v1 scope cut (SPEC.md §3 Alternatives rejected).
- Shopping list is read-only: checking/confirming an item never writes back to
  `pantry_item`. The user manually re-enters purchases. Don't wire this up even if it
  seems like an obvious convenience — it's an explicit scope cut (SPEC.md §3).
- Several real recipe sites (allrecipes.com, simplyrecipes.com, seriouseats.com,
  foodnetwork.com) return HTTP 403 to a plain `curl`/basic HTTP client from this sandbox
  (bot/WAF protection, not a network restriction) — don't rely on them for manual E2E
  import testing or as fixtures. `bbcgoodfood.com` and `cooking.nytimes.com` do answer,
  and both carry `schema.org/Recipe` JSON-LD the importer parses.
- A *local* fixture page cannot be used for manual E2E import testing either: the SSRF
  guard rejects `localhost`/127.0.0.1 before connecting, which is the point of it. Test
  the fetch+parse path against one of the public URLs above, and the guard itself against
  `http://169.254.169.254/` (rejected before any packet leaves).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
