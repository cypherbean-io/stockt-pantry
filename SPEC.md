# Stockt Pantry — SPEC

## 1. Problem

There's no single place that answers "what can I cook right now?" People keep a mental
(or no) model of what's in their pantry, keep recipes scattered across bookmarks/photos/
memory, and manually cross-reference the two when deciding what to make — or discover a
missing ingredient mid-recipe. Grocery trips are driven by guesswork rather than an
actual gap between "what a recipe needs" and "what's on the shelf."

This app is for households (one or more people sharing a kitchen) who want a shared,
accurate record of pantry inventory and recipes, and a reliable answer to "what can I
make with what I have" plus "what do I need to buy for recipe X."

## 2. Scope

### In (v1)

- **Multi-tenant, self-hosted**: one deployment serves many independent households.
  Each household's pantry and recipes are isolated from every other household.
- **Households with multiple members**: a household is its own entity; multiple user
  accounts can belong to one household and share its pantry/recipes.
- **Invite-only signup**: no public registration form. An existing household member
  generates a single-use invite link and shares it out-of-band (no email sending).
- **Auth**: email + password via an auth library (Lucia or Auth.js) handling session
  cookies and password hashing.
- **Canonical ingredient catalog**: ingredients are catalog entries (not free text) with
  an optional density (g/mL) for mass↔volume conversion. Pantry items and recipe
  ingredient lines reference catalog entries.
- **Pantry inventory**: per-household list of `(ingredient, quantity, unit)`. Minimal
  fields only — no expiration date, location, or cost tracking in v1.
- **Recipes**: name, base servings, ordered steps (text), and an ingredient list of
  `(ingredient, quantity, unit)` tied to the canonical catalog.
- **Recipe scaling**: a user can view a recipe at a target serving count; ingredient
  quantities scale proportionally, and "can I make this" is evaluated against the
  scaled amounts.
- **Recipe import from URL**: paste a URL, the app fetches the page, extracts a
  `schema.org/Recipe` (JSON-LD) block if present, parses ingredient lines into
  qty/unit/free-text-name, and presents a **review-and-confirm screen** where the user
  maps each line to a catalog ingredient (or creates a new one) before the recipe is
  saved. Nothing is saved from an import without user confirmation.
- **"What can I make" matching**: exact ingredient + quantity match. A recipe (at its
  current serving scale) is "makeable" if, for every ingredient line, the pantry holds
  a matching catalog ingredient at a quantity that converts to at least the required
  amount.
- **Unit conversion**: free conversion within mass (g/oz/lb) and within volume
  (mL/cup/tbsp/tsp/L), plus count units. Mass↔volume conversion uses the ingredient's
  density when present. If a required conversion has no density and needs one (i.e. the
  recipe unit and pantry unit are different dimensions), that ingredient is marked
  **"can't verify"** rather than silently assumed present or absent, and the recipe as a
  whole is not marked makeable while any line is unresolved.
- **Shopping list**: for a selected recipe (at its current scale), list every ingredient
  line that is missing or short, with the quantity still needed. Read-only output — the
  user manually re-enters purchases into the pantry afterward; the list does not write
  back to pantry state.
- **Self-hosting packaging**: Docker Compose bringing up the app container and a
  Postgres container together.

### Out (v1)

- Public/open signup.
- Expiration dates, storage location, purchase date/cost on pantry items.
- Shopping-list-to-pantry sync (checking an item off does not touch inventory).
- Barcode scanning.
- Nutrition information.
- Meal planning / calendar scheduling.
- Transactional email of any kind (invites are shareable links only).
- Recipe photo/image uploads.
- Editing the density table for existing ingredients through non-admin UI (see Design —
  density data is seeded; user-added ingredients get an optional density field but there
  is no bulk-edit/admin surface in v1).

## 3. Design

### Stack

- **Framework**: Next.js (App Router), TypeScript, server actions / route handlers for
  mutations.
- **ORM/DB**: Drizzle ORM against Postgres.
- **Auth**: Lucia or Auth.js, email + password, server-side sessions in HTTP-only
  cookies.
- **Packaging**: `docker-compose.yml` with two services — `app` (Next.js) and `db`
  (Postgres). App config (DB URL, session secret) via environment variables, documented
  in `.env.example` (names only, no values).

### Data model (conceptual)

- `household` — id, name.
- `user` — id, email, password_hash, household_id.
- `invite` — id, household_id, token (single-use), created_by, expires_at, used_at.
- `unit` — id, name (e.g. "gram", "cup"), dimension (`mass` | `volume` | `count`),
  base-unit conversion factor within its dimension.
- `ingredient` — id, household_id (catalog is per-household, so two households can name
  things independently and one household's typos don't pollute another's), name,
  density_g_per_ml (nullable).
- `pantry_item` — id, household_id, ingredient_id, quantity, unit_id.
- `recipe` — id, household_id, name, base_servings, steps (ordered text), source_url
  (nullable, set when imported).
- `recipe_ingredient` — id, recipe_id, ingredient_id, quantity, unit_id.

Ingredient catalog is scoped per household rather than global, trading some duplication
across households for zero cross-household coupling — simpler isolation story, and
matches "self-hosted, small number of households" scale.

### Matching algorithm

For a recipe at serving scale `s` (default 1.0 = base_servings):

1. For each `recipe_ingredient` line, compute `required = quantity * s`.
2. Look up the household's `pantry_item` for the same `ingredient_id`.
   - No pantry item → **missing**, shortfall = `required`.
3. Convert pantry quantity to the recipe line's unit:
   - Same dimension (mass↔mass, volume↔volume, count↔count) → direct conversion,
     always resolvable.
   - Cross-dimension (mass↔volume) → requires `ingredient.density_g_per_ml`.
     - Present → convert via density.
     - Absent → **unresolved** (not missing, not sufficient — a distinct state shown
       to the user as "can't verify without density").
4. Compare converted pantry quantity to `required`:
   - `>= required` → **have enough**.
   - `< required` → **short**, shortfall = `required - converted`.
5. Recipe-level status = **makeable** only if every line is "have enough". Any
   "missing"/"short"/"unresolved" line makes it not-makeable, but the UI distinguishes
   the three so the user knows whether buying something would fix it (missing/short) or
   the data itself is insufficient (unresolved).

Shopping list = every line that is missing or short, with its shortfall quantity in the
recipe's original unit.

### Recipe import flow

1. User submits a URL.
2. Server-side fetcher retrieves the page (see Security — SSRF mitigations below) and
   extracts `schema.org/Recipe` JSON-LD (name, recipeIngredient[], recipeInstructions,
   recipeYield).
   - No JSON-LD Recipe block found → import fails with an explicit error; no fallback
     scraping heuristics in v1 (avoids building a bespoke HTML-guessing parser).
3. Each `recipeIngredient` string is parsed into `(quantity, unit_text, name_text)`
   using a best-effort parser (leading number/fraction, known unit words, remainder as
   name).
4. Review-and-confirm screen: one row per parsed line, showing the parsed qty/unit and
   a fuzzy-matched suggestion against the household's ingredient catalog (or "create
   new ingredient: <name_text>"). User edits/confirms every row.
5. Only on explicit save does the recipe + recipe_ingredient rows get written. Nothing
   from the fetch is persisted before confirmation.

### Alternatives rejected

- **Global (cross-household) ingredient catalog** — rejected to keep tenant isolation
  simple and avoid one household's data-entry choices affecting another's matching.
- **Presence-only matching** (ignore quantity) — rejected per your requirement for
  exact quantity matching; accepted the added complexity of a unit/density system as
  the necessary cost.
- **Full HTML scraping fallback when no JSON-LD is present** — rejected for v1; the
  parser surface area and fragility (every site's markup differs) isn't worth it before
  the core product is proven. `schema.org/Recipe` covers the large majority of modern
  recipe sites.
- **Shopping-list-writes-back-to-pantry** — rejected for v1 to avoid guessing purchased
  quantities/units on the user's behalf; a manual step is a smaller, safer surface than
  an implicit inventory mutation.

## 4. Security & privacy

**Data touched**: household names, user emails, password hashes, pantry contents,
recipe contents, imported source URLs. No payment data, no third-party PII beyond the
account owner's own email.

**Trust boundaries crossed**:
- Browser ↔ app server (standard session-cookie auth boundary).
- App server ↔ Postgres (internal, same Docker network in the compose setup).
- **App server → arbitrary external URL (new, from recipe import)** — this is the one
  genuinely new attack surface in v1, and it's a classic SSRF vector: a user-supplied
  URL fetched server-side can be pointed at internal services, cloud metadata endpoints
  (`169.254.169.254`), or the app's own internal network.

**SSRF mitigations for the import fetcher** (required, not optional):
- Resolve the URL's host and reject if it resolves to a private/loopback/link-local
  range (RFC1918, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, etc.) before connecting.
- Allow only `http`/`https` schemes.
- Disable automatic redirect-following, or re-validate the target of every redirect hop
  against the same IP-range check (redirect-based SSRF bypass is the common failure
  mode here).
- Enforce a request timeout (e.g. 5s) and a response size cap (e.g. 2MB) to avoid the
  fetcher being used as a DoS proxy or memory exhaustion vector.
- No credentials, cookies, or internal headers are attached to the outbound fetch.

**Tenant isolation**: every query that touches `pantry_item`, `recipe`, `ingredient`,
`recipe_ingredient` is scoped by the session's `household_id` at the query layer (not
just filtered in the UI) — this is the one invariant that must never be violated, since
a miss here leaks one household's inventory/recipes to another.

**Auth/session**: passwords hashed with the auth library's default (argon2id or
equivalent) — no custom hashing. Sessions are HTTP-only, `SameSite=Lax` cookies.
Invite tokens are single-use, random (128-bit+), and time-limited; used/expired tokens
are rejected server-side, not just hidden in the UI.

**Logging**: request logs may include request path and household_id; never log
passwords, session tokens, invite tokens, or full pantry/recipe contents. Import
fetcher logs the target URL and outcome (success/failure/rejected-as-private-IP) for
debugging SSRF-mitigation behavior, not the fetched page content.

**Secrets**: DB connection string and session secret via environment variables only,
documented by name in `.env.example`, never committed. Per repo-wide rule, `.env*` and
`secrets/**` are never read or printed by tooling.

## 5. Test plan

**Matching engine** (pure logic, no DB — easiest to test exhaustively):
- Exact match: pantry qty == required qty, same unit → makeable.
- Surplus: pantry qty > required → makeable.
- Shortfall: pantry qty < required, same unit → short, correct shortfall value.
- Missing ingredient entirely (no pantry_item row) → missing, shortfall == required.
- Same-dimension conversion: recipe wants grams, pantry has ounces → converts and
  compares correctly.
- Cross-dimension with density present: recipe wants mL, pantry has grams, density set
  → converts via density correctly.
- Cross-dimension with density absent: recipe wants mL, pantry has grams, no density →
  status is "unresolved", recipe not marked makeable, distinct from "missing"/"short".
- Recipe scaling: scaling servings by 2x doubles every required quantity and changes
  makeable/not-makeable status accordingly at the boundary.
- Zero/negative quantity inputs are rejected at the data-entry layer (not reached by
  matching logic with invalid data).

**Tenant isolation** (integration, hits DB):
- User in household A cannot read, via any API route, a pantry item / recipe / invite
  belonging to household B, even by guessing an ID.
- Ingredient catalog lookups during import-mapping only surface the current household's
  ingredients.

**Auth/invite flow**:
- Invite token works exactly once; second use is rejected.
- Expired invite token is rejected.
- Login with wrong password fails; session is not created.
- Session cookie is HTTP-only and not readable from client JS (assert cookie flags).

**Recipe import**:
- URL with valid `schema.org/Recipe` JSON-LD → parsed lines shown on review screen,
  nothing persisted until confirm.
- URL with no JSON-LD Recipe block → clear failure, no partial recipe created.
- URL resolving to a private/loopback IP → fetch is rejected before any network call
  reaches that host (mock DNS resolution in the test to assert the guard fires).
- Redirect from an allowed URL to a private IP → rejected (tests the redirect
  revalidation, not just the initial URL).
- Oversized response (> cap) → fetch aborted, clear failure surfaced to user.
- Ambiguous ingredient line (e.g. "a pinch of salt") → parser produces a low-confidence
  row that still requires explicit user confirmation, not a silent default.

**Shopping list**:
- Recipe with all lines short/missing → shopping list contains every such line with
  correct shortfall quantities in the recipe's original unit.
- Recipe fully makeable → shopping list is empty.
- Confirming/checking a shopping list item does not alter pantry_item rows (verifies
  the explicit no-write-back decision).

## 6. Verification

End-to-end procedure to prove the core loop works after implementation:

1. `docker compose up` — app and Postgres both come up healthy.
2. Create household A via the first-run flow (or seed script), generate an invite,
   accept it as a second user in the same household — both land in the same pantry.
3. Add pantry items for household A: e.g. 500g flour, 2 cups sugar, 3 eggs (count).
4. Import a recipe from a real URL known to expose `schema.org/Recipe` markup (e.g. a
   basic cookie recipe) — walk the review screen, map ingredients to catalog entries
   (creating new ones as needed), confirm, and verify it lands in the recipe list.
5. View the recipe's "can I make this" status:
   - Confirm it correctly reports makeable/not-makeable/unresolved per the actual
     pantry contents entered in step 3.
   - Change the target serving count and confirm quantities and status update.
6. Generate the shopping list for that recipe and confirm it lists exactly the
   missing/short ingredients with correct shortfall amounts.
7. Open a private browsing session, create household B, and confirm it cannot see any
   of household A's pantry items, recipes, or invite tokens via the UI or by directly
   hitting API routes with guessed IDs.
8. Attempt to import a recipe from a URL pointing at `http://169.254.169.254/` (or a
   test double simulating it) and confirm the fetch is rejected before any request
   reaches that address.
