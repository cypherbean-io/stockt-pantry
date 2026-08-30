import { createHash, randomBytes } from "node:crypto";

/**
 * Bearer secrets: session tokens and invite tokens.
 *
 * Both follow the same shape. The raw token is minted from a CSPRNG, handed to
 * exactly one place (a cookie, or the invite link the user shares out-of-band),
 * and never stored. What the database holds is `hashToken()` of it, so a
 * database read — a backup, a leaked dump, a `select *` in a log line — cannot
 * be replayed as a live session or a working invite.
 *
 * The hash is a plain SHA-256, deliberately, where `password.ts` uses a slow
 * KDF. A password is low-entropy and guessable, so the cost parameter is the
 * defence; a 256-bit random token is not guessable at all, so a slow hash would
 * buy nothing and add latency to every authenticated request.
 */

/** 256 bits, comfortably past SPEC.md §4's "128-bit+" floor for invites. */
export const TOKEN_BYTES = 32;

/** How long a session cookie stays valid without re-authenticating. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Invites are shorter-lived than sessions on purpose: an invite travels over
 * whatever channel the user picked (chat, paper, email they do not control),
 * where a session token only ever sits in one browser.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** base64url so the value survives a URL path segment unescaped. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * The stored form of a token.
 *
 * Lookups are by this value against a unique index. Postgres' comparison is not
 * constant-time, but the thing being compared is already a hash — a timing
 * signal about how many leading bytes matched is not invertible into a token.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * `now` is a parameter rather than a `Date.now()` call so expiry is testable
 * without faking the clock, and so a single request stamps one instant across
 * every row it writes.
 */
export function expiresAt(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}
