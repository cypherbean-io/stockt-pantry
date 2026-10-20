import { describe, expect, it } from "vitest";

import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  loginAttemptAllowed,
  loginWindowCutoff,
} from "./throttle";

/**
 * The login throttle's policy. The counter itself is a Postgres row
 * (`recordLoginAttempt`), exercised end to end in
 * `src/db/login-throttle.db.test.ts`; this pins the two rules it applies.
 */

describe("loginAttemptAllowed", () => {
  it("allows the attempt that reaches the limit and refuses the one after it", () => {
    // The count includes the attempt being made, so the limit-th is the last
    // one that gets as far as the password check.
    expect(loginAttemptAllowed(1)).toBe(true);
    expect(loginAttemptAllowed(LOGIN_MAX_ATTEMPTS)).toBe(true);
    expect(loginAttemptAllowed(LOGIN_MAX_ATTEMPTS + 1)).toBe(false);
  });

  it("stays shut however far past the limit the count has run", () => {
    // Refused attempts are still counted, so the number keeps climbing while
    // someone hammers a locked address.
    expect(loginAttemptAllowed(LOGIN_MAX_ATTEMPTS * 100)).toBe(false);
  });
});

describe("loginWindowCutoff", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");

  it("is exactly one window before now", () => {
    expect(now.getTime() - loginWindowCutoff(now).getTime()).toBe(LOGIN_WINDOW_MS);
  });

  it("does not move the instant it was given", () => {
    const before = now.getTime();
    loginWindowCutoff(now);
    expect(now.getTime()).toBe(before);
  });
});
