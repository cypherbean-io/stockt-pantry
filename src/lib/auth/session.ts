import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { scopeForSession, type HouseholdScope, type VerifiedSession } from "@/db/scope";

import { clearedSessionCookie, sessionCookie, sessionCookieName } from "./cookie";
import { authenticate, logOut, type IssuedSession } from "./service";

/**
 * The data access layer for auth: the only place the session cookie is read or
 * written.
 *
 * Next.js' own guidance is to put the check next to the data rather than in a
 * layout — a layout does not re-render on every navigation and does not control
 * whether nested segments render, so an auth check there is decoration. Pages,
 * server actions and route handlers each call `requireSession()` or
 * `requireScope()` for themselves.
 */

/**
 * `cache` memoises this for the duration of one render pass, so a page that
 * checks the session and then renders three components that also check it
 * makes one query rather than four.
 */
export const currentSession = cache(async (): Promise<VerifiedSession | undefined> => {
  const store = await cookies();
  return authenticate(store.get(sessionCookieName())?.value);
});

export async function requireSession(): Promise<VerifiedSession> {
  const session = await currentSession();
  if (session === undefined) {
    redirect("/login");
  }
  return session;
}

/**
 * The bridge from "who is asking" to "what they may touch". Every tenant query
 * in a page or action should get its scope from here — nothing else in
 * `src/app/` should be calling `unsafeHouseholdScopeFromId`.
 */
export async function requireScope(): Promise<HouseholdScope> {
  return scopeForSession(await requireSession());
}

/**
 * Cookies can only be set from a server action or route handler, not while a
 * Server Component is rendering — HTTP does not allow a `Set-Cookie` after the
 * response has started streaming.
 */
export async function startSession(issued: IssuedSession): Promise<void> {
  const store = await cookies();
  const cookie = sessionCookie(issued.token, issued.expiresAt);
  store.set(cookie.name, cookie.value, cookie.options);
}

/**
 * Deletes the session row first, then clears the cookie. That order matters: if
 * the delete fails the user still holds a cookie for a session that still
 * exists, which is honest. Clearing first and failing the delete would leave a
 * live session with nothing pointing at it and no way to revoke it.
 */
export async function endSession(): Promise<void> {
  const store = await cookies();
  await logOut(store.get(sessionCookieName())?.value);
  const cookie = clearedSessionCookie();
  store.set(cookie.name, cookie.value, cookie.options);
}
