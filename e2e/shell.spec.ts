import { E2E_EMAIL, E2E_HOUSEHOLD_NAME } from "./credentials";
import { expect, test } from "./fixtures";
import { E2E_DISPOSABLE_STORAGE_STATE } from "./server";

/**
 * The persistent app shell, in a real browser (SPEC.md §5 Smoke 1–2).
 *
 * `shell.test.tsx` and `nav.test.tsx` already cover the markup and the
 * active-indicator logic without a browser, and they are the faster, sharper
 * tests. What they cannot cover is the wiring: that the shell is actually in
 * the root layout on every route, that `usePathname()` resolves to the route
 * the server just served, that the disclosures open on a click, and that
 * signing out revokes a session rather than only hiding it.
 *
 * Every test here starts from `storageState` — one household, signed up
 * through the real form by `global-setup.ts` — except the sign-out group,
 * which deliberately starts signed out. See the note there.
 */

/**
 * Written out rather than imported from `NAV_ITEMS`. Two reasons, and the
 * second is the real one: `nav.tsx` is a `"use client"` module whose imports
 * only resolve inside Next's bundler, and an expectation derived from the code
 * under test cannot catch that code being wrong.
 */
const ROUTES = [
  { href: "/recipes", label: "Recipes" },
  { href: "/pantry", label: "Pantry" },
  { href: "/household", label: "Household" },
] as const;

test.describe("the signed-in shell", () => {
  for (const { href, label } of ROUTES) {
    test(`shows the household's name in the header on ${href}`, async ({ page }) => {
      await page.goto(href);

      // The one `banner` on the page. `PageHeader` also renders a `<header>`,
      // but it is inside `<main>`, where the element carries no landmark role.
      const banner = page.getByRole("banner");

      await expect(banner).toBeVisible();
      // SPEC.md §4: the tenant you are writing to should be visible at all
      // times, which is a safety feature in a multi-household deployment.
      await expect(banner).toContainText(E2E_HOUSEHOLD_NAME);
      await expect(banner.getByRole("navigation", { name: "Primary" })).toBeVisible();
      // Sanity: the shell is chrome around the page, not instead of it.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });

    test(`marks ${label} as the current section on ${href}`, async ({ page }) => {
      await page.goto(href);

      const nav = page.getByRole("navigation", { name: "Primary" });

      // Announced, not merely tinted — SPEC.md §1 counts "nothing indicates
      // where you are" as a defect, and a background shade fixes that for
      // some readers only.
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // Exactly one, on every route. Two would be the prefix match in
      // `isCurrent` having gone wrong.
      await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
    });
  }

  test("keeps the signed-in email out of the page until the account menu is opened", async ({
    page,
  }) => {
    // `/recipes` rather than `/household`, which prints the address in its own
    // page description and would make this pass for the wrong reason.
    await page.goto("/recipes");

    // SPEC.md §3.3: the panel is not rendered at all until it is opened, so
    // the address is not in the markup — not merely hidden by CSS, and so not
    // in a screenshot or an over-the-shoulder glance.
    await expect(page.getByText(E2E_EMAIL)).toHaveCount(0);

    await page.getByRole("button", { name: "Account" }).click();

    await expect(page.getByText(E2E_EMAIL)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test.describe("signing out", () => {
  /**
   * The second session `global-setup.ts` minted, which exists to be destroyed.
   * Signing out deletes the *session row*, so doing it while holding the shared
   * `storageState` would revoke the cookie every other spec in this
   * `fullyParallel` run is using; `logOut` deletes only the session its own
   * token hashes to, so this one is free to go.
   *
   * Signing in here instead would be the obvious alternative and is the reason
   * this fixture exists: a password typed into a form is captured verbatim by
   * the aria snapshot Playwright attaches to any failing test, by trace DOM
   * snapshots, and by the copies of both that the HTML reporter writes into
   * `playwright-report/data/`. No spec types a credential; `global-setup.ts`
   * does, and it is neither traced nor error-contexted.
   */
  test.use({ storageState: E2E_DISPOSABLE_STORAGE_STATE });

  test("revokes the session server-side, not just the cookie", async ({ page }) => {
    await page.goto("/household");

    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");

    // The assertion that matters. A logout that only cleared the cookie would
    // also land here; asking for a page that requires a session is what tells
    // the two apart.
    await page.goto("/recipes");
    await expect(page).toHaveURL(/\/login$/);
  });
});
