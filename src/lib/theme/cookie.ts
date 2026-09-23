import { secureCookies, type Cookie } from "../auth/cookie";
import type { AuthEnv } from "../auth/env";

/**
 * The theme cookie's name, flags and allowlist (SPEC.md §3.4).
 *
 * Pure, and deliberately shaped like `src/lib/auth/cookie.ts`: the flags are a
 * value a test can assert rather than arguments at a `cookies().set(...)` call
 * site. `src/app/actions/theme.ts` is the only caller.
 *
 * Why a cookie at all, rather than the usual `localStorage` plus a blocking
 * inline `<script>` in `<head>`: the server already knows the theme before it
 * writes the first byte, so the correct `data-theme` is in the HTML and there
 * is no first-paint flash to engineer around — and nothing here would need
 * `'unsafe-inline'` under a future CSP (SPEC.md §3.10).
 */

export const THEMES = ["light", "dark", "system"] as const;

export type Theme = (typeof THEMES)[number];

const BASE_NAME = "stockt_theme";

/** A year. A theme is a preference, not a credential; it should outlive the session. */
export const THEME_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The only way a cookie value becomes a `Theme`.
 *
 * `httpOnly` stops page JavaScript writing this cookie, but the user — or
 * anything with devtools — can still put an arbitrary string in it, and that
 * string flows into `data-theme` on `<html>`. React escapes attribute values,
 * so this is not an injection sink and the blast radius of getting it wrong is
 * "the page is the wrong colour". It is allowlisted anyway, because a value
 * that reaches an attribute should not be un-validated on principle
 * (SPEC.md §4).
 *
 * Membership rather than a pattern: the work is the same for `"light"` and for
 * a 10 KB string, and there is no regex to get subtly wrong.
 */
export function parseTheme(raw: string | undefined): Theme {
  return THEMES.find((theme) => theme === raw) ?? "system";
}

/**
 * The `__Host-` prefix, on the same condition the session cookie uses. See
 * `src/lib/auth/cookie.ts` for why it is conditional: a `__Host-` cookie
 * without `Secure` is rejected outright by the browser, and `Secure` cannot be
 * used on `http://localhost`.
 */
export function themeCookieName(env: AuthEnv = process.env): string {
  return secureCookies(env) ? `__Host-${BASE_NAME}` : BASE_NAME;
}

export function themeCookie(theme: Theme, env: AuthEnv = process.env): Cookie {
  return {
    name: themeCookieName(env),
    value: theme,
    options: {
      // The client never reads this — the toggle keeps its own copy in React
      // state and the server sends the rendered attribute. HttpOnly is free
      // here, so it is taken.
      httpOnly: true,
      // Lax, not Strict: arriving from an emailed invite link should render in
      // the theme the user chose rather than snapping to the default.
      sameSite: "lax",
      path: "/",
      secure: secureCookies(env),
      maxAge: THEME_MAX_AGE_SECONDS,
    },
  };
}
