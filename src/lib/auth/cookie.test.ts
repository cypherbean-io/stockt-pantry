import { describe, expect, it } from "vitest";

import { clearedSessionCookie, sessionCookie, sessionCookieName, secureCookies } from "./cookie";
import { SESSION_TTL_MS } from "./token";

/**
 * SPEC.md §4: "Sessions are HTTP-only, SameSite=Lax cookies", and §5 asks for
 * the flags themselves to be asserted.
 *
 * The flags are built by a pure function rather than inlined at the `cookies()`
 * call site precisely so that this test is possible — a test that spun up a
 * browser to check `document.cookie` would prove the same thing far less
 * directly.
 */

const EXPIRES = new Date("2026-01-08T00:00:00.000Z");

describe("sessionCookie", () => {
  it("is not readable from client JavaScript", () => {
    expect(sessionCookie("token", EXPIRES, {}).options.httpOnly).toBe(true);
  });

  it("is not sent on cross-site requests that could forge an action", () => {
    // Lax still sends the cookie on a top-level GET navigation, which is what
    // makes an emailed link to /household work, but withholds it from a
    // cross-site form POST.
    expect(sessionCookie("token", EXPIRES, {}).options.sameSite).toBe("lax");
  });

  it("covers the whole app rather than one path", () => {
    expect(sessionCookie("token", EXPIRES, {}).options.path).toBe("/");
  });

  it("expires with the session row it points at", () => {
    expect(sessionCookie("token", EXPIRES, {}).options.expires).toEqual(EXPIRES);
  });

  it("carries the token as its value under the session cookie name", () => {
    const cookie = sessionCookie("opaque-token", EXPIRES, {});

    expect(cookie.name).toBe(sessionCookieName({}));
    expect(cookie.value).toBe("opaque-token");
  });
});

describe("sessionCookieName", () => {
  it("takes the __Host- prefix once the cookie is Secure", () => {
    // The prefix makes the browser refuse any same-named cookie that carries a
    // Domain attribute, so a sibling subdomain cannot plant a session for us.
    expect(sessionCookieName({ NODE_ENV: "production" })).toBe("__Host-stockt_session");
  });

  it("drops the prefix where Secure is unavailable", () => {
    // A __Host- cookie without Secure is rejected outright by the browser, so
    // keeping the prefix in local development would break login entirely.
    expect(sessionCookieName({})).toBe("stockt_session");
    expect(sessionCookieName({ NODE_ENV: "development" })).toBe("stockt_session");
  });

  it("satisfies the rest of the prefix's requirements when it uses it", () => {
    // __Host- also demands Path=/ and no Domain. Getting the name right and the
    // flags wrong means the browser silently discards every session cookie.
    const cookie = sessionCookie("t", EXPIRES, { NODE_ENV: "production" });

    expect(cookie.name.startsWith("__Host-")).toBe(true);
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.path).toBe("/");
    expect(cookie.options).not.toHaveProperty("domain");
  });

  it("clears under the same name it set, in both configurations", () => {
    for (const env of [{}, { NODE_ENV: "production" }]) {
      expect(clearedSessionCookie(env).name).toBe(sessionCookie("t", EXPIRES, env).name);
    }
  });
});

describe("secureCookies", () => {
  it("requires HTTPS in production", () => {
    expect(secureCookies({ NODE_ENV: "production" })).toBe(true);
  });

  it("allows plain HTTP for local development, where there is no TLS to use", () => {
    // A `Secure` cookie on http://localhost is simply never stored, which
    // presents as "login silently does nothing".
    expect(secureCookies({ NODE_ENV: "development" })).toBe(false);
    expect(secureCookies({})).toBe(false);
  });

  it("can be forced on for a deployment terminating TLS at a proxy", () => {
    // Behind a reverse proxy the app itself sees http, so NODE_ENV alone is not
    // enough to decide.
    expect(secureCookies({ NODE_ENV: "development", SESSION_COOKIE_SECURE: "true" })).toBe(true);
  });

  it("propagates into the cookie it builds", () => {
    expect(sessionCookie("t", EXPIRES, { NODE_ENV: "production" }).options.secure).toBe(true);
    expect(sessionCookie("t", EXPIRES, { NODE_ENV: "development" }).options.secure).toBe(false);
  });
});

describe("clearedSessionCookie", () => {
  it("expires the cookie immediately and blanks the token", () => {
    const cookie = clearedSessionCookie({});

    expect(cookie.name).toBe(sessionCookieName({}));
    expect(cookie.value).toBe("");
    expect(cookie.options.maxAge).toBe(0);
  });

  it("keeps the flags that decide which cookie is being replaced", () => {
    // A browser matches Set-Cookie against name/path/domain. Clearing with a
    // different path leaves the original cookie in place.
    const cookie = clearedSessionCookie({ NODE_ENV: "production" });

    expect(cookie.options.path).toBe("/");
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(true);
  });
});

describe("session lifetime", () => {
  it("is finite, so an abandoned cookie stops working on its own", () => {
    expect(SESSION_TTL_MS).toBeGreaterThan(0);
    expect(Number.isFinite(SESSION_TTL_MS)).toBe(true);
  });
});
