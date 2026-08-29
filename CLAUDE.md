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

Not yet scaffolded (see SPEC.md §3 Stack). Commands below are the planned ones once the
Next.js app exists — update this table for real as soon as `package.json` lands.

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev server | `npm run dev` |
| Test (all) | `npm test` |
| Test (single file) | `npm test -- <path/to/file>` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Build | `npm run build` |
| Local stack (app + Postgres) | `docker compose up` |
| DB migrations (Drizzle) | `npm run db:migrate` / `npm run db:generate` |

Prefer running a single test file over the whole suite while iterating.

## Architecture

<!-- Only what cannot be derived by reading the code: boundaries, invariants,
     and decisions with rationale. Not a directory listing. -->

- Stack: Next.js (App Router) + TypeScript, Drizzle ORM against Postgres, Lucia or
  Auth.js for email+password sessions in HTTP-only cookies. Packaged as Docker Compose
  (`app` + `db` services).
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
  that must never be violated (SPEC.md §4).
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

- No fallback HTML scraping for recipe import — if a page has no `schema.org/Recipe`
  JSON-LD block, the import fails explicitly. Don't add scraping heuristics; this was a
  deliberate v1 scope cut (SPEC.md §3 Alternatives rejected).
- Shopping list is read-only: checking/confirming an item never writes back to
  `pantry_item`. The user manually re-enters purchases. Don't wire this up even if it
  seems like an obvious convenience — it's an explicit scope cut (SPEC.md §3).
- Two real recipe sites (allrecipes.com, simplyrecipes.com) return HTTP 403 to a plain
  `curl`/basic HTTP client from this sandbox (bot/WAF protection, not a network
  restriction) — don't rely on them for manual E2E import testing or as fixtures; use a
  local fixture page or a site confirmed to respond to a plain fetch.
