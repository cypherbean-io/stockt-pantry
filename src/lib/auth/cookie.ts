import type { AuthEnv } from "./env";
import { SESSION_TTL_MS } from "./token";

/**
 * The session cookie's name and flags (SPEC.md §4: "HTTP-only, SameSite=Lax").
 *
 * These are built by a pure function rather than written inline at the
 * `cookies().set(...)` call site so that SPEC.md §5's "assert cookie flags" is
 * a real assertion on the value that ships, not a browser test approximating
 * it. `session.ts` is the only caller.
 */

const BASE_NAME = "stockt_session";

/**
 * `__Host-` is a browser-enforced guarantee, not decoration: a cookie carrying
 * the prefix is rejected outright unless it is `Secure`, `Path=/`, and has no
 * `Domain` attribute. Without it, a compromised sibling on a shared parent
 * domain — `other.example.com` next to `pantry.example.com` — can set
 * `stockt_session=<its own token>; Domain=example.com`, and which of the two
 * cookies wins is not specified. The victim would then be operating inside the
 * attacker's household, writing their pantry into it.
 *
 * The prefix is conditional because it cannot be used without `Secure`, and
 * `Secure` cannot be used on `http://localhost`. The cost is that flipping a
 * deployment between the two invalidates existing cookies, which presents as
 * "everyone has to sign in again" — acceptable, and better than a name that
 * silently promises less than it looks like it does.
 */
export function sessionCookieName(env: AuthEnv = process.env): string {
  return secureCookies(env) ? `__Host-${BASE_NAME}` : BASE_NAME;
}

export type CookieOptions = {
  readonly httpOnly: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly secure: boolean;
  readonly expires?: Date;
  readonly maxAge?: number;
};

export type Cookie = {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptions;
};

/**
 * `Secure` must be off for local `http://localhost` development — a browser
 * silently drops a Secure cookie on a plain-HTTP origin, which presents as
 * "login appears to work and then nothing is logged in".
 *
 * `NODE_ENV` alone is not sufficient for a deployment that terminates TLS at a
 * reverse proxy: the app sees http even though the browser sees https. Hence
 * the explicit override.
 */
// Named without a `use` prefix on purpose — `useSecureCookies` reads as a React
// hook to the linter, and to a reader.
export function secureCookies(env: AuthEnv): boolean {
  if (env.SESSION_COOKIE_SECURE === "true") return true;
  return env.NODE_ENV === "production";
}

function baseOptions(env: AuthEnv): Omit<CookieOptions, "expires" | "maxAge"> {
  return {
    // The whole point: client JS cannot read the session token, so an XSS bug
    // cannot exfiltrate a working session.
    httpOnly: true,
    // Lax still sends the cookie on a top-level GET, so following an invite
    // link into the app works, but withholds it from a cross-site form POST.
    // Server Actions additionally check Origin against Host.
    sameSite: "lax",
    path: "/",
    secure: secureCookies(env),
  };
}

export function sessionCookie(
  token: string,
  expires: Date,
  env: AuthEnv = process.env,
): Cookie {
  return {
    name: sessionCookieName(env),
    value: token,
    // Matches the session row's own `expires_at`. The cookie expiry is a
    // convenience for the browser; the row is what actually decides.
    options: { ...baseOptions(env), expires },
  };
}

export function clearedSessionCookie(env: AuthEnv = process.env): Cookie {
  return {
    name: sessionCookieName(env),
    value: "",
    // Name, path and domain are what a browser matches a replacement cookie
    // against — clearing with different flags leaves the original in place.
    options: { ...baseOptions(env), maxAge: 0 },
  };
}

export { SESSION_TTL_MS };
