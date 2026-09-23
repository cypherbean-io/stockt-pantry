"use server";

import { cookies } from "next/headers";

import { parseTheme, themeCookie } from "@/lib/theme/cookie";

/**
 * Persist the theme (SPEC.md §3.4).
 *
 * The only server action this change adds, and the only write in it: an enum
 * in, a cookie out, no table touched and no id anywhere. It deliberately
 * requires no session, because the toggle has to work on `/login` and
 * `/signup` — a sign-in page that cannot be read in the dark is the case the
 * theme control exists for.
 *
 * That makes it a public endpoint, as every server action is: reachable by
 * anyone who can POST, not only by the header that renders the button. Hence
 * `parseTheme` on the argument rather than trusting the caller.
 *
 * Nor is it a CSRF vector, though the usual one-line version of that argument
 * is slightly stronger than what Next actually does: it rejects an `Origin`
 * that *disagrees* with `Host`, and lets a request carrying no `Origin` at all
 * through with a warning (`server/app-render/action-handler.js`). A browser
 * always attaches `Origin` to a cross-site POST, including a plain form post,
 * so browser-driven CSRF is genuinely blocked — and a request handcrafted
 * without one is not carrying anybody's cookies unwillingly. Worth knowing
 * before generalising the sentence to an action where the stakes are higher
 * than a colour change.
 *
 * Setting a cookie is why this is an action and not something the layout does
 * while rendering: HTTP does not allow a `Set-Cookie` once the response has
 * started streaming.
 */
export async function setThemeAction(theme: string): Promise<void> {
  const cookie = themeCookie(parseTheme(theme));
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
}
