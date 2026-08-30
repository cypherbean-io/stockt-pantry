import { describe, expect, it } from "vitest";

import {
  INVITE_TTL_MS,
  SESSION_TTL_MS,
  TOKEN_BYTES,
  expiresAt,
  generateToken,
  hashToken,
} from "./token";

/**
 * Session and invite tokens (SPEC.md §4: invite tokens are "single-use, random
 * (128-bit+), and time-limited").
 *
 * Both kinds are bearer secrets, so they follow the same rules: minted from a
 * CSPRNG, stored only as a SHA-256 hash, and looked up by that hash. The
 * database never holds a value that can be replayed.
 */

describe("generateToken", () => {
  it("draws at least 128 bits of entropy", () => {
    expect(TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));

    expect(tokens.size).toBe(100);
  });

  it("is safe to put in a URL path without escaping", () => {
    // Invites are shared as links (SPEC.md §2), so the token travels in a path
    // segment. base64url keeps `+`, `/` and `=` out of it.
    for (let i = 0; i < 50; i += 1) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("hashToken", () => {
  it("maps the same token to the same hash", () => {
    const token = generateToken();

    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("maps different tokens to different hashes", () => {
    expect(hashToken("alpha")).not.toBe(hashToken("beta"));
  });

  it("does not reveal the token it was given", () => {
    const token = generateToken();

    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("expiresAt", () => {
  it("adds the lifetime to the given instant rather than reading the clock", () => {
    // Deterministic by construction: the caller supplies `now`, so nothing in
    // the suite depends on real time.
    const now = new Date("2026-01-01T00:00:00.000Z");

    expect(expiresAt(now, 1000).toISOString()).toBe("2026-01-01T00:00:01.000Z");
  });

  it("gives invites a shorter life than sessions", () => {
    // An invite is a secret shared out-of-band over an unknown channel; it
    // should not sit valid for as long as a session on a browser the user
    // controls.
    expect(INVITE_TTL_MS).toBeLessThan(SESSION_TTL_MS);
    expect(INVITE_TTL_MS).toBeGreaterThan(0);
  });
});
