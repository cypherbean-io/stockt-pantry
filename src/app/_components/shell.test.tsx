import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Header } from "./shell";

/**
 * The persistent app shell of SPEC.md §3.3.
 *
 * `Header` is the presentational half and `AppShell` is the async half that
 * resolves the session and the household name. Only the first is rendered
 * here: the second reads `cookies()` and queries Postgres, and what it would
 * prove — that the header appears on every route and that signing out works —
 * is what the Playwright suite of SPEC.md §5 is for.
 *
 * The last test in this file is not about markup at all. It is the guard for
 * the misreading this slice makes possible: a shell in the root layout looks
 * like an auth boundary, and CLAUDE.md and `src/lib/auth/session.ts` are both
 * explicit that a layout is not one — it does not re-render on every
 * navigation and does not control whether nested segments render. Every page
 * keeps its own check, and this asserts they still have one.
 */

const EMAIL = "someone@example.test";
const HOUSEHOLD = "Ashby Road";

function header(props: { householdName?: string } = {}): string {
  return renderToStaticMarkup(
    <Header householdName={props.householdName ?? HOUSEHOLD} email={EMAIL} theme="system" />,
  );
}

describe("the header", () => {
  it("names the household you are operating in", () => {
    // SPEC.md §4 calls this a safety feature rather than a leak: in a
    // deployment with several households, seeing which one you are writing to
    // at all times is the point.
    expect(header()).toContain(HOUSEHOLD);
  });

  it("still renders when the household row has no name to show", () => {
    // `findHousehold` returns `HouseholdRow | undefined`, so the name is
    // optional at the type level. A header that crashed on it would take every
    // signed-in page with it.
    expect(header({ householdName: undefined })).toContain("Stockt");
  });

  it("keeps the signed-in email off the always-visible bar", () => {
    // The composed assertion for SPEC.md §3.3's one judgement call: all three
    // of household, email and Sign out are reachable, but only the first is on
    // the bar. `account-menu.test.tsx` asserts the same thing about the menu
    // in isolation; this one asserts nothing else in the header leaked it.
    //
    // Scoped to rendered markup, which is the guarantee that was asked for —
    // the address is not on the screen and not in a screenshot. Next still
    // serialises it into the RSC flight payload as a Client Component prop;
    // see the comment in `account-menu.tsx`.
    expect(header()).not.toContain(EMAIL);
  });

  it("is a banner landmark, so it can be skipped", () => {
    expect(header()).toMatch(/^<header\b/);
  });

  it("carries the navigation, which is now the only copy of it", () => {
    expect(header()).toMatch(/<nav[^>]*aria-label="Primary"/);
    for (const href of ["/recipes", "/pantry", "/household"]) {
      expect(header()).toContain(`href="${href}"`);
    }
  });

  it("carries the theme control on every page, not only where it was needed", () => {
    expect(header()).toMatch(/aria-label="[^"]*Theme[^"]*"/i);
  });
});

/**
 * Every `page.tsx` in the app, as text. Read rather than imported: importing
 * them would pull in the database client, and the question being asked is
 * about the source, not about behaviour.
 */
const pagesDirectory = fileURLToPath(new URL("../", import.meta.url));

function pageFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) return pageFiles(`${path}/`);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

/**
 * Comments stripped, because every one of these files explains its own auth
 * check in prose directly above it. Reading the raw text instead is not a
 * near-miss: the first version of this guard matched the docstring on
 * `/pantry`, `/recipes` and `/household`, and stayed green with the real
 * `await requireScope()` deleted from all three.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const PAGES = pageFiles(pagesDirectory).map((path) => ({
  path: path.slice(pagesDirectory.length),
  source: code(readFileSync(path, "utf8")),
}));

/**
 * The pages that render for someone with no session at all.
 *
 * An allowlist rather than a heuristic — "imports `@/db/queries/`" was the
 * other candidate and it exempts any page that reads tenant data through an
 * intermediate module, silently. This way a page added tomorrow has to be
 * named here to opt out, and the default is that it needs a check.
 */
const SIGNED_OUT = new Set([
  // The front door. Calls `currentSession()` and redirects; renders nothing.
  "page.tsx",
  "login/page.tsx",
  "signup/page.tsx",
  "join/[token]/page.tsx",
]);

const GUARDED = PAGES.filter(({ path }) => !SIGNED_OUT.has(path));

describe("the shell is presentation, not a gate", () => {
  it("is asserting this against pages it actually found", () => {
    // A walk that silently found nothing would make the checks below pass
    // vacuously, which is the one way this can lie.
    expect(PAGES.length).toBeGreaterThanOrEqual(10);
    expect(GUARDED.length).toBeGreaterThanOrEqual(6);
  });

  it("exempts only pages that are still there", () => {
    // A stale entry left behind by a rename would silently exempt whatever
    // next takes that path.
    const found = new Set(PAGES.map(({ path }) => path));

    for (const path of SIGNED_OUT) {
      expect(found.has(path), `${path} is exempted but does not exist`).toBe(true);
    }
  });

  it.each(GUARDED.map(({ path }) => path))("leaves %s holding its own check", (path) => {
    // Next.js' own guidance, and CLAUDE.md's: put the check next to the data.
    // A layout does not re-render on every navigation and does not decide
    // whether a nested segment renders, so a check in the shell would be
    // decoration — and deleting a page's own call because "the shell handles
    // it now" is the regression this exists to catch. There is no
    // `middleware.ts` either, so these calls are the only enforcement there is.
    const source = GUARDED.find((page) => page.path === path)?.source ?? "";

    // `await` in the pattern: both of these return a promise, and a bare
    // `requireScope();` neither waits for the redirect nor yields a scope.
    expect(/await require(Scope|Session)\(\)/.test(source)).toBe(true);
  });

  it("is not satisfied by a page that only mentions the check in a comment", () => {
    // The self-test for `code()` above. Without it this whole describe block
    // passes on prose, which is exactly how it failed the first time.
    expect(/await require(Scope|Session)\(\)/.test(code("// await requireScope()\n"))).toBe(false);
    expect(/await require(Scope|Session)\(\)/.test(code("/* await requireScope() */"))).toBe(false);
  });

  it("leaves the shell itself unable to be mistaken for the check", () => {
    // `AppShell` renders `children` in both branches — it never returns a
    // redirect or withholds the page. If it ever did, a reader would
    // reasonably conclude the pages no longer need their own call.
    const shell = code(readFileSync(new URL("./shell.tsx", import.meta.url), "utf8"));

    expect(shell).not.toContain("redirect(");
    expect(shell).not.toContain("requireSession(");
    expect(shell).not.toContain("requireScope(");
  });
});
