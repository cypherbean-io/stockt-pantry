import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/**
 * Tenant scoping (SPEC.md §4).
 *
 * Every read or write that touches `ingredient`, `pantry_item`, `recipe`,
 * `recipe_ingredient` or `invite` goes through a `HouseholdScope`. The type is
 * branded so a bare string — a route parameter, a form field, anything the user
 * controls — cannot be passed where a scope is expected. The only way to make
 * one is `householdScope()`, and in application code the only argument it
 * should ever receive is the household id off the verified session.
 */

declare const scopeBrand: unique symbol;

export type HouseholdScope = {
  readonly householdId: string;
  readonly [scopeBrand]: true;
};

/** Matches the `uuid` primary key on `household`. */
const HOUSEHOLD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build a scope from a raw household id.
 *
 * **This validates shape, not ownership.** It cannot tell a household id that
 * came off a verified session from one that came out of a URL, so
 * `unsafeHouseholdScopeFromId(params.householdId)` would typecheck, produce a
 * perfectly valid scope, and hand the caller someone else's pantry. The `unsafe`
 * prefix is there to make every call site greppable.
 *
 * `scopeForSession()` below is the normal way in, and application code should
 * use nothing else — the callers of this function are that one and the tests.
 *
 * Throws rather than returning a result union: there is no sensible way to
 * continue serving a request whose household id is malformed, and a scope that
 * can be `undefined` invites callers to fall back to an unscoped query.
 */
export function unsafeHouseholdScopeFromId(householdId: string): HouseholdScope {
  if (!HOUSEHOLD_ID.test(householdId)) {
    throw new Error("Refusing to build a scope from a malformed household id");
  }
  return { householdId } as HouseholdScope;
}

/**
 * A session that has already been resolved against the `session` table — the
 * row existed and had not expired. Only `src/db/queries/auth.ts` produces one;
 * nothing constructs it from request input.
 */
export type VerifiedSession = {
  readonly userId: string;
  readonly householdId: string;
  readonly email: string;
  readonly expiresAt: Date;
};

/**
 * The supported way to get a scope.
 *
 * The household id comes off the session row rather than off anything the
 * request carried, which is the whole point: there is no argument a caller can
 * pass that redirects this at another tenant. Every page, server action and
 * route handler that touches tenant data should start here.
 */
export function scopeForSession(session: VerifiedSession): HouseholdScope {
  return unsafeHouseholdScopeFromId(session.householdId);
}

/** Any table that carries the tenant key. */
export type TenantTable = PgTable & { readonly householdId: PgColumn };

/**
 * The scoping predicate, plus whatever else the caller needs.
 *
 * Query functions build their `where` clause with this rather than writing
 * `eq(table.householdId, ...)` by hand, so "did this query get scoped" is a
 * question about which helper was called, not about reading the clause.
 */
export function ownedBy(
  scope: HouseholdScope,
  table: TenantTable,
  ...extra: readonly (SQL | undefined)[]
): SQL {
  const condition = and(eq(table.householdId, scope.householdId), ...extra);
  // `and` only yields undefined when every condition is undefined, which the
  // household predicate rules out. Fail closed anyway rather than assert.
  return condition ?? sql`false`;
}
