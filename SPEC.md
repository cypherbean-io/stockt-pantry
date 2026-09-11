# Stockt Pantry — SPEC: a modern UI

Successor to `docs/specs/0001-initial.md`, which this document refers to as **§0001**.
That spec built the whole application and said nothing about how it should look. This one
is only about how it looks and how you move around it.

---

## 1. Problem

The app answers its question correctly and shows the answer in browser-default HTML.
There is no stylesheet anywhere in `src/` — `src/app/layout.tsx` sets a system font, a
`48rem` max width and `2rem` of padding, and everything below that is unstyled markup with
roughly eight ad-hoc inline `style` objects scattered across `_components/fields.tsx`,
`pantry/pantry-row.tsx` and `recipes/import/import-flow.tsx`.

What that actually costs, concretely:

- **The headline question is answered in prose.** `/recipes` renders a plain `<table>`
  whose status column is a sentence — `"2 to buy, 1 can't verify"` — in the same weight
  and colour as the recipe name and the serving count. "What can I cook right now?"
  (§0001 §1) requires reading every row to the end.
- **The four match statuses are visually identical.** `have` / `short` / `missing` /
  `unresolved` is the central distinction in this app, and §0001 is explicit that the
  three not-makeable states must stay distinguishable because each has a different fix.
  Today all four are plain text in a `<td>`.
- **There is no navigation.** Each page hand-writes its own `·`-separated line of links,
  and they disagree: `/pantry` offers two, `/recipes` offers four, `/recipes/[id]` offers
  one. Nothing indicates where you are.
- **Sign out exists in exactly one place** — the bottom of `/household`, under an
  `<h2>Session</h2>`. There is no way to leave from anywhere else.
- **It is not usable on a phone**, which is where a pantry app is actually used. Tables
  overflow at 375px, inputs render at browser defaults (iOS zooms the viewport on focus
  for anything under 16px), and every tap target is default-sized.
- **Error colour is `#b00020`, hardcoded in three files.** No token, no dark variant, no
  contrast check, no way to change it in one place.
- **A thrown error shows Next.js' default error page.** There is no `error.tsx`,
  `not-found.tsx` or `loading.tsx` in the tree. A production incident currently looks
  like an unstyled framework stack page.

Who this is for: everyone using a self-hosted deployment, most acutely someone standing in
a kitchen holding a phone.

---

## 2. Scope

### In

1. **Tailwind CSS v4** as the styling foundation, wired through PostCSS.
2. **A design-token layer** in `src/app/globals.css`: semantic colour, spacing, radius and
   type tokens, defined once for light and once for dark.
3. **A persistent app shell** in the root layout — product name, primary navigation with
   an active indicator, household name, an account disclosure holding the signed-in email
   and Sign out, and a theme control.
4. **A tri-state theme control** (Light / Dark / System) backed by a server-set cookie, so
   the correct theme is present in the first byte of HTML and there is no flash.
5. **A restyle of every existing screen**: `/login`, `/signup`, `/join/[token]`,
   `/recipes`, `/recipes/new`, `/recipes/import`, `/recipes/[id]`, `/pantry`,
   `/household`.
6. **Status-grouped recipe list.** `/recipes` groups recipes under four headings —
   Ready to cook / Needs shopping / Partly unverifiable / Can't verify — with counts.
   The grouping is derived from match results the page already computes; no new query.
7. **A four-bucket classifier** as pure, exhaustively-tested logic in
   `src/lib/matching/summary.ts`, alongside `summarise()` moved out of `_components/`.
8. **A small component vocabulary** under `src/app/_components/ui/` (button, badge, card,
   field, page header, empty state) plus a hand-rolled inline SVG icon set.
9. **Responsive behaviour**: every table collapses to a stacked card layout below `sm`;
   nav collapses to a disclosure; all interactive targets ≥ 44×44 CSS px on touch.
10. **Route-level states**: `app/error.tsx`, `app/not-found.tsx`, and `loading.tsx` for
    the data-fetching routes.
11. **Copy to clipboard** on the shopping list, with a fallback for non-secure contexts.
12. **Micro-interactions**: ~120–180 ms colour/border transitions, disclosure expand and
    collapse, fade-in on inline form messages, pending state on submit buttons — all
    behind `prefers-reduced-motion`.
13. **Playwright** as a new local-only smoke suite (`npm run test:e2e`), plus pure guard
    tests for tokens, contrast, the theme cookie, the bucket classifier and packaging.

### Out

- **No route changes.** Every URL stays exactly what it is. `/` keeps redirecting.
- **No changes to server actions, queries, the matching engine, or the schema**, with one
  exception: a new `setThemeAction`, which writes a cookie and touches no table.
- **No new data on any page** beyond household name and signed-in email in the shell.
  No dashboard, no search, no filtering, no sorting controls, no pagination.
- **No toast/notification layer.** Inline form messages stay inline where they are; they
  gain styling and a fade-in and nothing else. (Toasts were named in the motion option
  I offered — dropping them keeps this a reskin. Say the word and it comes back.)
- **No optimistic UI and no autosave.** The pantry keeps its per-row Save button.
- **No component library, no icon package, no font package.** No `shadcn/ui`, no Radix,
  no `lucide-react`, no `next/font`.
- **No print stylesheet** (offered alongside clipboard; not chosen).
- **No CI wiring.** `.github/` does not exist in this repo and this change does not
  create it. `npm run test:e2e` is run by hand.
- **No CSP header.** Removing inline styles improves the posture for one later, but Next
  still emits inline styles of its own, so this change does not claim to unlock it.
- **No recipe-import behaviour change**, including no fallback HTML scraping. The import
  screen is restyled only.

---

## 3. Design

### 3.1 Dependencies

Two, both `devDependencies`, both build-time only:

| Package | Why | Footprint |
| --- | --- | --- |
| `tailwindcss@^4` | The styling foundation | Ships `@tailwindcss/oxide` with per-platform native binaries |
| `@tailwindcss/postcss@^4` | The PostCSS plugin Next 16 expects | Thin wrapper over the above |

Measured: 12 JavaScript packages (`tailwindcss`, `@tailwindcss/{node,oxide,postcss}`,
`lightningcss`, `jiti`, `enhanced-resolve`, `tapable`, `graceful-fs`, `@alloc/quick-lru`)
plus 22 per-platform native binary packages, of which exactly one of each pair installs on
any given machine.

Plus `@playwright/test` as a `devDependency` for the smoke suite; its browsers are
downloaded on demand by `npx playwright install chromium` and are not vendored.

Nothing lands in `dependencies`, so nothing enters the runtime image. `next.config.ts`
keeps `output: "standalone"`, `npm ci` in the Dockerfile's `builder` stage already installs
devDependencies, and the compiled stylesheet lands in `.next/static/chunks/` — Turbopack
emits it as a chunk rather than into a `css/` directory — which the `runtime` stage already
copies wholesale. **Risk to watch:** the image is `node:26-alpine` (musl), so
`npm ci` must resolve `@tailwindcss/oxide-linux-x64-musl`. If that fails the Docker build
breaks even though the host build is green — §6 verifies the image, not just the host.

`postcss.config.mjs` at the repo root:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Next 16.3.3 runs Turbopack for both `dev` and `build`, and Turbopack resolves the
project-root PostCSS config first by default, so `experimental.turbopackLocalPostcssConfig`
is **not** needed and `next.config.ts` is unchanged
(`next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopackLocalPostcssConfig.md`).

**Source detection must be scoped explicitly.** Tailwind v4 detects its own sources by
walking the repository, and it extracts candidate class names by scanning text rather than
by parsing. Left to itself it read this spec: the first build emitted `mx-auto`,
`min-h-dvh`, `px-4`, `w-full` and `max-w-4xl` off the code samples in §3.3, and
`container`, `table`, `hidden`, `inline`, `truncate` and `filter` off ordinary English in
the surrounding prose — none of which appear anywhere in `src/`. So `globals.css` opens
with `@import "tailwindcss" source(none);` followed by `@source "../**/*.tsx";`, scoping
the scan to components only. A handful of false positives survive from JSX attribute
values (`type="hidden"` yields `.hidden`); that is ~200 bytes and inherent to a scanner,
and is not worth further effort.

### 3.2 Token architecture

Tailwind v4's `@theme` block wants static values, but our tokens have to change at runtime
between light and dark. The documented way to bridge that is two layers: raw custom
properties that the cascade swaps, and `@theme inline` mapping them into Tailwind's
utility generation.

`src/app/globals.css`:

```css
@import "tailwindcss";

/* `dark:` should follow our attribute, not only the OS. Rarely needed — the
   semantic tokens below do almost all of the work — but available. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  --surface:        oklch(99%  0.002 260);
  --surface-raised: oklch(100% 0     0);
  --border:         oklch(90%  0.005 260);
  --ink:            oklch(24%  0.010 260);
  --ink-muted:      oklch(46%  0.012 260);
  --accent:         oklch(52%  0.16  258);
  --accent-ink:     oklch(99%  0     0);
  --focus:          oklch(58%  0.19  258);
  --status-ok:      /* green   */ …;  --status-ok-ink:      …;
  --status-warn:    /* amber   */ …;  --status-warn-ink:    …;
  --status-mixed:   /* orange  */ …;  --status-mixed-ink:   …;
  --status-gap:     /* red     */ …;  --status-gap-ink:     …;
  --status-unknown: /* violet  */ …;  --status-unknown-ink: …;
}

/* Follow the OS unless the user pinned light. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark values */ }
}
/* Pinned dark on a light OS. */
[data-theme="dark"] { /* the same dark values */ }

@theme inline {
  --color-surface: var(--surface);
  --color-ink:     var(--ink);
  /* … */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
}
```

The cascade resolves correctly in all four combinations, and it does so without
JavaScript:

| OS preference | `data-theme` | Result |
| --- | --- | --- |
| light | absent | light |
| dark | absent | dark (media query matches) |
| dark | `light` | light (`:not([data-theme=light])` excludes it) |
| light | `dark` | dark (attribute rule matches) |

The dark values are necessarily written twice, once inside the media query and once for
the attribute. Plain CSS has no way to share a declaration block across a media query and
a bare selector, so instead of pretending otherwise, **`src/design/tokens.test.ts` asserts
the two blocks declare exactly the same property names.** Drift becomes a failing test
rather than a token that is only dark when the OS agrees.

**Typography** is the system stack above: zero bytes downloaded, no build-time network, no
third-party request ever, no FOUT and no layout shift. The cost is that the app is not
pixel-identical between macOS and Linux, which for a self-hosted household tool is nothing.

### 3.3 The app shell

`src/app/layout.tsx` becomes:

```tsx
import "./globals.css";

const theme = parseTheme((await cookies()).get(themeCookieName())?.value);

<html lang="en" data-theme={theme === "system" ? undefined : theme}>
  <body className="min-h-dvh bg-surface text-ink font-sans antialiased">
    <AppShell>{children}</AppShell>
  </body>
</html>
```

`src/app/_components/shell.tsx` is a Server Component:

```tsx
const session = await currentSession();
if (session === undefined) {
  return <div className="…centred auth container…">{children}</div>;
}
const household = await findHousehold(scopeForSession(session));
return (
  <>
    <Header householdName={household?.name} email={session.email} theme={theme} />
    <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
  </>
);
```

**This is presentation, never a gate, and the file will say so in a comment.** CLAUDE.md
and `src/lib/auth/session.ts` are both explicit that a layout does not re-render on every
navigation and does not control whether nested segments render, so an auth check there is
decoration. Every page keeps its own `requireScope()` / `requireSession()` call exactly as
it has today. `currentSession()` is already wrapped in React `cache()`, so the shell and
the page it wraps share one session query per render pass.

Two consequences worth stating rather than discovering later:

- `findHousehold(scope)` is a second query per full page load, and `/household` will run
  it twice (once in the shell, once in the page). It is a primary-key lookup on a table
  with one row per household; that is an acceptable price for not restructuring the page.
- Reading `cookies()` in the root layout makes `/login` and `/signup` dynamic. Every other
  route already is.

**Header contents** (all three of the things chosen, arranged so the always-visible
surface stays minimal):

```
┌────────────────────────────────────────────────────────────┐
│ Stockt · Ashby Road      Recipes  Pantry  Household   ◐  ▾ │
└────────────────────────────────────────────────────────────┘
                                                          │
                              ┌───────────────────────────┴──┐
                              │ erichelstad@gmail.com        │
                              │ ─────────────────────────────│
                              │ Household settings           │
                              │ Sign out                     │
                              └──────────────────────────────┘
```

Household name inline; **email and Sign out behind the account disclosure**. Today the
email appears on one screen; putting it in the always-visible bar would put it into every
screenshot and every over-the-shoulder glance of every page. Collapsing it keeps it one
click away without that. Flagging this because it is my reading of "show all three" — if
you want the address on the bar itself, it is a one-line change.

Sign out posts to the existing `logOutAction`, which already calls `endSession()` and
redirects to `/login`. No new action.

**Navigation** (`src/app/_components/nav.tsx`, `"use client"`) uses `usePathname()` to set
`aria-current="page"`, and below `sm` collapses behind a disclosure button with
`aria-expanded` / `aria-controls`, closing on Escape and on outside click. The per-page
`·`-separated link lines are deleted; contextual links that are not navigation (e.g.
"Import from a URL" on `/recipes`) become buttons in the page header instead.

### 3.4 Theme

- `src/lib/theme/cookie.ts` — **pure**, mirroring `src/lib/auth/cookie.ts` so the flags
  are a testable value rather than an argument at a `cookies().set(...)` call site:

  ```ts
  export type Theme = "light" | "dark" | "system";
  export function parseTheme(raw: string | undefined): Theme;   // allowlist; anything else → "system"
  export function themeCookieName(env?: AuthEnv): string;        // `__Host-` prefix when secure, as the session cookie does
  export function themeCookie(theme: Theme, env?: AuthEnv): Cookie;
  ```

  `httpOnly: true` — the client never reads it; it persists through a server action and
  keeps its own copy in React state. `sameSite: "lax"`, `path: "/"`, `secure` from the
  existing `secureCookies(env)`, `maxAge` one year.

- `src/app/actions/theme.ts` — `setThemeAction(theme: string)`: `parseTheme` it, set the
  cookie, return. No session required (it must work on `/login`), no id, no table.

- `src/app/_components/theme-toggle.tsx` — `"use client"`, tri-state cycle
  Light → Dark → System. On click it sets `document.documentElement.dataset.theme`
  immediately (or removes the attribute for System) so the flip is instant, then
  `startTransition(() => setThemeAction(next))` persists it. The server-rendered attribute
  and the client-set attribute always agree afterwards, because the next server render
  reads the cookie the action just wrote.

This is why the cookie approach was chosen over `localStorage`: no blocking inline
`<script>` in `<head>`, so nothing here would need `'unsafe-inline'` or a nonce under a
future CSP, and there is no first-paint flash to engineer around.

### 3.5 Status and the four buckets

New pure module `src/lib/matching/summary.ts` — no React, no DB, so it sits with the rest
of the exhaustively-tested matching logic:

```ts
export type RecipeBucket = "ready" | "shopping" | "partly-unverifiable" | "unverifiable";

export function countByStatus(result: MatchResult): Record<LineStatus, number>;
export function recipeBucket(result: MatchResult): RecipeBucket;
export function summarise(result: MatchResult): string;   // moved out of _components/match.tsx
export const BUCKET_ORDER: readonly RecipeBucket[];
export const BUCKET_LABEL: Record<RecipeBucket, string>;
```

`recipeBucket` is derived from the lines alone, not from `result.makeable`:

```
toBuy      = missing + short
unresolved = unresolved

unresolved > 0 && toBuy > 0  →  "partly-unverifiable"
unresolved > 0               →  "unverifiable"
toBuy      > 0               →  "shopping"
otherwise                    →  "ready"
```

Written this way the function is total — there is no unreachable branch to guess at — and
a test asserts the invariant that `recipeBucket(r) === "ready"` if and only if
`r.makeable`. A recipe with no ingredient lines is vacuously ready, which matches the
existing behaviour `summarise()` already documents.

The bucket row still names both counts, so "Partly unverifiable" is not a dead end:
`Focaccia — 2 to buy · 1 can't verify`.

Display order is `ready → shopping → partly-unverifiable → unverifiable`: most actionable
first. Empty buckets render no heading.

**Colour never carries meaning alone.** Every status has a token, a glyph and a text
label:

| | Token | Glyph | Line label | Bucket heading |
| --- | --- | --- | --- | --- |
| have | `--status-ok` | check | have enough | Ready to cook |
| short | `--status-warn` | half-circle | short | Needs shopping |
| missing | `--status-gap` | minus-circle | missing | *(rolls into Needs shopping)* |
| — | `--status-mixed` | half-diamond | — | Partly unverifiable |
| unresolved | `--status-unknown` | diamond | can't verify without a density | Can't verify |

`--status-mixed` is deliberately close in hue to `--status-warn` — the two both mean "go
and buy something" — with the glyph carrying the difference. It is a distinct token so the
contrast test covers it independently.

### 3.6 Component vocabulary

`src/app/_components/ui/`:

| File | Exports |
| --- | --- |
| `button.tsx` | `Button` (primary/secondary/ghost/danger, sm/md), `LinkButton` |
| `badge.tsx` | `StatusBadge` (takes a `LineStatus` or a `RecipeBucket`; glyph + label + token) |
| `card.tsx` | `Card`, `CardHeader` — the surface tables collapse into on narrow screens |
| `field.tsx` | `Field`, `FieldError`, `FormMessage` — shared by auth and pantry forms |
| `page-header.tsx` | `PageHeader` — title, description, action slot |
| `empty-state.tsx` | `EmptyState` — icon, sentence, primary action |

`src/app/_components/icons.tsx` holds the ~9 glyphs actually used (check, half-circle,
minus-circle, diamond, half-diamond, plus, menu, chevron, sun/moon/contrast) as inline SVG
components. No icon package: nothing ships that is not used, and there is no dependency
added for decoration.

`src/app/_components/fields.tsx` and `src/app/pantry/fields.tsx` are rewritten to sit on
`ui/field.tsx`; `src/app/_components/match.tsx` keeps `MatchTable` and `ShoppingList` but
imports its text helpers from `summary.ts`. `#b00020` disappears from all three files.

**Responsive rule**: every `<table>` in the app (`/recipes` list, `MatchTable`,
`/household` invites) renders as a real table at `sm` and above, and as stacked cards
below it, with the column names becoming labels. Not `overflow-x: auto` — a horizontally
scrolling table on a phone in a kitchen is not a fix.

### 3.7 Route-level states

- `src/app/error.tsx` — `"use client"` (Next requires it), renders a generic apology, a
  Try again button and, if present, `error.digest`. **It must never render
  `error.message` or `error.stack`.** CLAUDE.md is unambiguous: a `DrizzleQueryError`
  formats as `Failed query: <sql>\nparams: <bound values>` and that string carries
  password hashes, invite token hashes and whole recipes. `src/db/redact.ts` already
  strips driver errors at the query layer, but `error.tsx` is the last place a
  non-redacted error from anywhere else could surface. §5 adds a source-level guard.
- `src/app/not-found.tsx` — styled 404 inside the shell. `/recipes/[id]` already routes an
  unknown *and* another household's recipe to the same `notFound()`, deliberately; this
  page must not distinguish them either.
- `loading.tsx` for `/recipes`, `/pantry`, `/recipes/[id]`, `/household` — skeletons that
  mirror the real layout's dimensions so nothing jumps when the content arrives.

### 3.8 Copy to clipboard

`ShoppingList` gains a Copy button (`"use client"`, small, does not change the read-only
contract — it never writes to `pantry_item`).

```
Chana masala — shopping list (4 servings)
- Chickpeas: 240 g
- Tomatoes: 400 g
```

`navigator.clipboard` only exists in a secure context, and a self-hosted deployment on
`http://192.168.x.x:3000` is not one. So: feature-detect, and when it is absent render the
text in a pre-selected read-only `<textarea>` with "Select all and copy" rather than
throwing or silently doing nothing. Fires only on explicit click.

### 3.9 Files

**New** — `postcss.config.mjs`, `src/app/globals.css`, `src/app/error.tsx`,
`src/app/not-found.tsx`, four `loading.tsx`, `src/app/_components/shell.tsx`,
`nav.tsx`, `theme-toggle.tsx`, `account-menu.tsx`, `icons.tsx`, six files under
`_components/ui/`, `src/app/actions/theme.ts`, `src/lib/theme/cookie.ts`,
`src/lib/matching/summary.ts`, `src/design/contrast.ts`, `playwright.config.ts`,
`e2e/global-setup.ts`, `e2e/shell.spec.ts`, plus the test files in §5.

**Modified** — `package.json`, `.gitignore`, `.dockerignore`, `src/app/layout.tsx`, all
nine page files, `_components/fields.tsx`, `_components/match.tsx`,
`pantry/{fields,add-item-form,pantry-row}.tsx`, `household/invite-button.tsx`,
`join/[token]/join-form.tsx`, `recipes/_components/recipe-form.tsx`,
`recipes/import/import-flow.tsx`, `src/packaging/packaging.test.ts`, `README.md`,
`docs/INSTALL.md`, `CLAUDE.md` (a Commands row for `test:e2e`).

**Untouched** — `next.config.ts`, `Dockerfile`, `docker-compose*.yml`, `drizzle/`,
`src/db/**` (except reading `findHousehold` from the shell), `src/lib/auth/**`,
`src/lib/import/**`, `src/lib/matching/{match,units,from-storage}.ts`, `.github/`
(which does not exist).

### 3.10 Alternatives rejected

- **Zero-dependency CSS Modules + tokens.** No new dependency at all and total control,
  but every layout primitive gets hand-written and the responsive table-to-card work
  triples. Rejected in favour of Tailwind on the explicit dependency call.
- **shadcn/ui.** Fastest to a polished result, and by far the largest transitive footprint
  — Radix per component, `cva`, `clsx`, `tailwind-merge`, `lucide-react`. Too much
  supply chain for a nine-screen self-hosted app.
- **`localStorage` theme with a blocking inline `<script>`.** The common React pattern,
  and the reason so many apps need `'unsafe-inline'` in `style-src`/`script-src`. The
  cookie gets the same no-flash result with no inline script.
- **`next/font/google`.** Self-hosts at runtime, so no user-IP leak — but it downloads at
  *build* time, so the Docker `builder` stage would need egress to `fonts.gstatic.com` and
  an offline build would fail. Not worth it for a font.
- **A `(app)` route group holding the shell layout.** Cleaner separation of signed-in from
  signed-out chrome, but it moves twenty files and, worse, a `(app)/layout.tsx` reads like
  an auth boundary — precisely the misconception `src/lib/auth/session.ts` warns against.
  A root-layout shell that documents itself as presentation-only is safer to read.
- **Three buckets, with mixed folded into Needs shopping.** Fewer headings on a short
  list; loses the warning that the shopping list you are about to act on is knowably
  incomplete. Overruled by the four-bucket choice.
- **CSS-only `<details>` nav and a form-post theme toggle.** Would keep the chrome working
  with JavaScript disabled. Rejected in favour of instant theme switching and animatable
  nav; the *forms* still degrade, because server actions progressively enhance and none of
  that changes.

---

## 4. Security & privacy

**Data touched.** No new table, column, or tenant query. `findHousehold(scope)` is the
only query the shell adds, it already takes a branded `HouseholdScope`, and it is already
covered by `src/db/tenant-isolation.db.test.ts:91`. The tenant-isolation invariant is
untouched: nothing in this change accepts a household id from a URL, and
`unsafeHouseholdScopeFromId` keeps its two existing callers.

**New trust boundary: the theme cookie.** `stockt_theme` (or `__Host-stockt_theme` when
`Secure`) is user-controllable — `httpOnly` stops page JavaScript writing it, but the user,
or anything with devtools, can put an arbitrary string there. That string flows into
`data-theme={…}` on `<html>`. React escapes attribute values, so this is not an injection
sink, but the value is still allowlisted through `parseTheme()` before it is used, and
anything unrecognised becomes `"system"`. The blast radius if that failed is "the page is
the wrong colour"; it is validated anyway because a value that reaches an attribute should
never be un-validated on principle.

**New attack surface: one server action.** `setThemeAction` takes an enum, writes a
cookie, and touches nothing else. It intentionally requires no session so the toggle works
on `/login`. Next checks `Origin` against `Host` for server actions, so it is not a CSRF
vector, and the impact of forging one would be a colour change.

**New data on screen.** The signed-in email and the household name were previously visible
only on `/household`; they are now reachable from every page. The email sits behind the
account disclosure rather than on the header bar (§3.3) so it is not in every screenshot.
The household name is inline — it is the tenant you are operating in, and in a multi-tenant
deployment seeing it at all times is a safety feature, not a leak.

**What is logged: nothing new.** No `console` call is added anywhere in this change. The
one place a secret could newly escape is `error.tsx`, which is why §3.7 forbids
`error.message` and §5 adds a source-level guard for it. `src/db/redact.ts` is unchanged
and still the thing standing between a driver error and the logs.

**Third-party requests: zero, and now tested.** System fonts, inline SVG icons, no CDN, no
analytics, no external stylesheet. A self-hosted household app should make no outbound
browser requests at all, and the Playwright suite fails if any request during the smoke run
goes to an origin other than the app under test.

**Clipboard.** The shopping list is household data going onto the system clipboard. It
only ever happens on an explicit click, and the non-secure-context fallback puts the text
in a textarea rather than reaching for a permission the browser will not grant.

**CSP posture.** Replacing inline `style` attributes with classes, and refusing the inline
theme script, both move toward a strict CSP later. This change does not add one and does
not claim to have earned one — Next emits inline styles of its own.

**Test credentials.** The E2E suite needs a `HOUSEHOLD_SIGNUP_TOKEN` and a password.
Neither is written into a file. `playwright.config.ts` generates both with
`crypto.randomUUID()` at config load and passes them to the `webServer` environment and to
`global-setup.ts`, which is the same reasoning `docker-compose.test.yml` uses when it picks
trust auth rather than inventing a password to commit. `e2e/.auth/` holds a real session
cookie for the throwaway database and is added to both `.gitignore` and `.dockerignore`,
along with `e2e/`, `playwright.config.ts`, `playwright-report/` and `test-results/`.

---

## 5. Test plan

### Pure — `npm test -- --project=unit`, no Docker, no browser

**`src/lib/theme/cookie.test.ts`**
- `parseTheme` returns the value for `"light"`, `"dark"`, `"system"`.
- Falls back to `"system"` for `undefined`, `""`, `"LIGHT"` (case-sensitive, documented),
  `'"><script>alert(1)</script>'`, and a 10 KB string.
- `themeCookieName()` is `stockt_theme` without `Secure` and `__Host-stockt_theme` with
  it — the same conditional the session cookie uses.
- `themeCookie()` sets `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `secure` tracking
  `secureCookies(env)`, and a one-year `maxAge`.

**`src/design/contrast.test.ts`**
- `oklch(100% 0 0)` → `#ffffff`, `oklch(0% 0 0)` → `#000000`.
- `contrast(white, black) === 21`, `contrast(x, x) === 1`, `contrast(a, b) === contrast(b, a)`.
- A known mid-grey pair against a hand-computed WCAG ratio.
- Out-of-sRGB-gamut input is reported, not silently clipped.

**`src/design/tokens.test.ts`** — parses `src/app/globals.css` as text
- The light block and both dark blocks declare **exactly the same property names**. This
  is the drift guard for the duplicated dark block (§3.2).
- The two dark blocks (media-query and attribute) declare identical values.
- Every declared colour token parses and is inside sRGB gamut.
- Every pair in an explicit table meets WCAG 2.2 AA **in both themes**: `--ink` and
  `--ink-muted` on `--surface` and `--surface-raised` ≥ 4.5:1; each `--status-*-ink` on
  its `--status-*` ≥ 4.5:1; `--accent-ink` on `--accent` ≥ 4.5:1; `--focus` on
  `--surface` ≥ 3:1.
- No raw `#rrggbb` / `rgb()` colour literal appears anywhere under `src/app/**/*.tsx` —
  the regression guard for `#b00020` creeping back in.

**`src/lib/matching/summary.test.ts`**
- `recipeBucket` over the full truth table of (`toBuy > 0`, `unresolved > 0`): ready,
  shopping, unverifiable, partly-unverifiable.
- The invariant: for every fixture in `match.test.ts`, `recipeBucket(r) === "ready"` **iff**
  `r.makeable`.
- A recipe with no ingredient lines → `"ready"`.
- 2 short + 1 unresolved → `"partly-unverifiable"`; 1 missing + 1 short → `"shopping"`;
  1 unresolved only → `"unverifiable"`.
- `summarise` text per bucket, including the both-counts case `"2 to buy · 1 can't verify"`.
- `BUCKET_ORDER` covers every member of `RecipeBucket` exactly once, and `BUCKET_LABEL` is
  a total `Record` (adding a fifth bucket fails `tsc`, not just the test).

**`src/packaging/packaging.test.ts`** — additions in the file's existing text-reading style
- `postcss.config.mjs` exists and registers `@tailwindcss/postcss`.
- `src/app/layout.tsx` imports `./globals.css`.
- `tailwindcss` and `@tailwindcss/postcss` are in `devDependencies`, not `dependencies` —
  they must never reach the runtime image.
- `.dockerignore` excludes `e2e/`, `playwright.config.ts`, `playwright-report/`,
  `test-results/`, and does **not** exclude `postcss.config.mjs` or `*.css`.
- The Dockerfile still copies `.next/static` (where the compiled stylesheet lands).
- `src/app/error.tsx` contains no `error.message`, `error.stack`, or `JSON.stringify(error`
  — with the CLAUDE.md rationale in the assertion's comment.

### Smoke — `npm run test:e2e`, Chromium against a real build

`global-setup.ts` signs up one fresh household through the real `/signup` form (exercising
the `HOUSEHOLD_SIGNUP_TOKEN` gate rather than routing around it) and saves `storageState`.
`playwright.config.ts` runs `npm run build && npm start` against the existing
`docker-compose.test.yml` Postgres on port 55432.

1. **Shell** — header present on `/recipes`, `/pantry`, `/household`; `aria-current="page"`
   tracks the route; household name visible; the account disclosure reveals the email and
   Sign out.
2. **Sign out** from the header lands on `/login`, and `/recipes` then redirects to
   `/login`.
3. **Theme, no flash** — with `colorScheme: "dark"` emulated and no cookie, the page is
   dark. Click to Light: `data-theme="light"` on `<html>` and the `stockt_theme` cookie is
   set with the expected flags. Reload and assert the **served HTML** already carries
   `data-theme="light"` — that is the actual no-flash guarantee, and it is deterministic in
   a way that sampling first paint is not. Assert no `<script>` in `<head>` reads a theme.
4. **Mobile, 375×667** — nav collapses; the menu button opens it and Escape closes it;
   every interactive target is ≥ 44×44 CSS px; `document.documentElement.scrollWidth <=
   window.innerWidth` on `/recipes`, `/pantry` and `/recipes/[id]` (no horizontal scroll).
5. **Four buckets end to end** — one setup spec creates, through the UI, a pantry and four
   recipes producing one of each bucket, including an ingredient with no density needed in
   grams against a pantry entry in millilitres for the unverifiable case. Asserts four
   headings, correct membership and counts, and that each status has a text label and not
   only a colour. The classifier itself is already exhaustively unit-tested; this proves it
   is wired to real rows.
6. **Not found** — `/recipes/<random-uuid>` renders the styled 404 inside the shell, with
   no stack text and nothing that distinguishes "does not exist" from "belongs to someone
   else".
7. **Clipboard** — with permissions granted, Copy on a shopping list puts the expected
   plain text on the clipboard. With `navigator.clipboard` deleted via `addInitScript`, the
   textarea fallback renders and nothing throws.
8. **No third-party requests** — a `page.on("request")` listener fails the run if any
   request leaves the app's own origin.

**Not covered, deliberately:** the recipe-import fetch. The SSRF guard rejects
`localhost`/`127.0.0.1` before connecting — that is the point of it — and the public sites
that do answer are not something a test suite should depend on. `/recipes/import` is
asserted for layout only.

---

## 6. Verification

One command, from a clean checkout with Docker running:

```bash
npm ci && npx playwright install chromium && npm run verify
```

where `verify` is added to `package.json` as:

```json
"verify": "npm run lint && npm run typecheck && npm test && npm run test:e2e"
```

That runs ESLint, `tsc --noEmit`, both Vitest projects (starting the throwaway Postgres for
the `db` project), then builds the app and drives the eight smoke specs in §5 against it.
Green means the tokens meet AA in both themes, the buckets classify correctly against real
rows, the theme survives a reload without a flash, the app fits a 375px screen, and nothing
phones home.

Then confirm the packaged image, because §3.1's musl risk is not visible from a host build:

```bash
docker compose up --build          # needs POSTGRES_PASSWORD in .env
curl -sI http://localhost:3000/login | head -1                         # 200
css=$(curl -s http://localhost:3000/login | grep -o '/_next/static/chunks/[^"]*\.css' | head -1)
curl -sI "http://localhost:3000$css" | head -3                         # 200, text/css
```

Finally, by eye — the part no assertion covers: `npm run dev`, then walk `/login` →
`/signup` → `/recipes` → `/recipes/[id]` → `/pantry` → `/household` at 375px and 1280px,
in both OS themes, cycling the toggle through all three states on each.
