import { describe, expect, it } from "vitest";

import { secureCookies } from "../auth/cookie";
import { parseTheme, THEMES, themeCookie, themeCookieName, THEME_MAX_AGE_SECONDS } from "./cookie";

/**
 * SPEC.md §5 "src/lib/theme/cookie.test.ts".
 *
 * The theme cookie is the one value in this app that is both user-controllable
 * and destined for an HTML attribute (SPEC.md §4). React escapes attribute
 * values, so an unvalidated string here would not be an injection sink — but
 * the blast radius being small is not a reason to let an unvalidated value
 * reach `data-theme`, and `parseTheme` is what keeps it from happening.
 *
 * The flags are built by a pure function for the same reason `src/lib/auth/
 * cookie.ts` is: so "is this cookie HttpOnly" is an assertion on the value that
 * ships rather than a browser test approximating it.
 */

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

describe("parseTheme", () => {
  it.each(THEMES)("keeps %s, which is a theme the app renders", (theme) => {
    expect(parseTheme(theme)).toBe(theme);
  });

  it("falls back to following the system when no cookie was sent", () => {
    // A first-time visitor has no cookie at all, and the tokens in globals.css
    // already answer that case through `prefers-color-scheme`. "system" is the
    // theme that leaves them alone.
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("")).toBe("system");
  });

  it("is case-sensitive, so only the exact stored spelling is honoured", () => {
    // Documented rather than incidental: the cookie is only ever written by
    // `themeCookie`, which writes lowercase. Anything else in it did not come
    // from this app.
    expect(parseTheme("LIGHT")).toBe("system");
    expect(parseTheme("Dark")).toBe("system");
  });

  it("refuses a value that is trying to escape the attribute it lands in", () => {
    // This string is the whole reason the allowlist exists. It flows into
    // `data-theme` on <html>; React escapes it, and it is still not allowed
    // through, because a value reaching an attribute should never be
    // un-validated on principle (SPEC.md §4).
    expect(parseTheme('"><script>alert(1)</script>')).toBe("system");
  });

  it("refuses an oversized value without doing any work proportional to it", () => {
    // A cookie is whatever the client put there. An allowlist answers a 10 KB
    // string in the same time it answers "light"; a regex or a `.includes`
    // scan over the value would not.
    expect(parseTheme("a".repeat(10_000))).toBe("system");
  });

  it("returns a value that round-trips back through itself", () => {
    // `setThemeAction` parses, writes, and the next render parses what it
    // wrote. A normalisation that did not survive that trip would flip the
    // theme back on the first reload.
    for (const theme of THEMES) {
      expect(parseTheme(themeCookie(theme, {}).value)).toBe(theme);
    }
  });
});

describe("themeCookieName", () => {
  it("takes the __Host- prefix once the cookie is Secure", () => {
    // The same conditional the session cookie uses, and for the same reason:
    // the prefix makes a browser refuse any same-named cookie carrying a
    // Domain attribute, so a sibling subdomain cannot plant one.
    expect(themeCookieName({ NODE_ENV: "production" })).toBe("__Host-stockt_theme");
  });

  it("drops the prefix where Secure is unavailable", () => {
    // A __Host- cookie without Secure is rejected outright, so keeping the
    // prefix on http://localhost would mean the theme never persisted.
    expect(themeCookieName({})).toBe("stockt_theme");
    expect(themeCookieName({ NODE_ENV: "development" })).toBe("stockt_theme");
  });

  it("satisfies the rest of the prefix's requirements when it uses it", () => {
    const cookie = themeCookie("dark", { NODE_ENV: "production" });

    expect(cookie.name.startsWith("__Host-")).toBe(true);
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.path).toBe("/");
    expect(cookie.options).not.toHaveProperty("domain");
  });

  it("does not collide with the session cookie", () => {
    // Both are set on the same path with the same flags. Sharing a name would
    // mean writing a theme destroyed the session.
    expect(themeCookieName({})).not.toBe("stockt_session");
  });
});

describe("themeCookie", () => {
  it("is not readable from client JavaScript", () => {
    // SPEC.md §3.4: the client never reads it. It persists through a server
    // action and the toggle keeps its own copy in React state, so HttpOnly
    // costs nothing and keeps one more string out of reach of an XSS bug.
    expect(themeCookie("light", {}).options.httpOnly).toBe(true);
  });

  it("is still sent when the app is reached by following a link", () => {
    // Lax, not Strict: arriving on /login from an emailed invite link should
    // render in the theme the user picked, not snap to the default.
    expect(themeCookie("light", {}).options.sameSite).toBe("lax");
  });

  it("covers the whole app rather than one path", () => {
    expect(themeCookie("light", {}).options.path).toBe("/");
  });

  it("carries the theme as its value", () => {
    expect(themeCookie("dark", {}).value).toBe("dark");
  });

  it("outlives the session, because a theme is not a credential", () => {
    // SPEC.md §3.4 asks for a year. Expiring with the session would mean
    // signing out reset the appearance of the sign-in page.
    expect(themeCookie("dark", {}).options.maxAge).toBe(ONE_YEAR_IN_SECONDS);
    expect(THEME_MAX_AGE_SECONDS).toBe(ONE_YEAR_IN_SECONDS);
  });

  it("tracks the same Secure decision as the session cookie", () => {
    // One decision, taken in one place. A theme cookie that was Secure where
    // the session cookie was not would simply never be stored in development.
    for (const env of [{}, { NODE_ENV: "production" }, { SESSION_COOKIE_SECURE: "true" }]) {
      expect(themeCookie("system", env).options.secure).toBe(secureCookies(env));
    }
  });
});
