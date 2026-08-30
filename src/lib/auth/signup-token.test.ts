import { describe, expect, it } from "vitest";

import type { AuthEnv } from "./env";
import { SIGNUP_TOKEN_VAR, signupTokenAccepted } from "./signup-token";

/**
 * SPEC.md §2 puts "public/open signup" out of scope for v1, while still asking
 * for one deployment to serve many households. Creating a household therefore
 * needs a deployment-level secret that the operator holds; joining an existing
 * household goes through an invite instead.
 */

const CONFIGURED: AuthEnv = { [SIGNUP_TOKEN_VAR]: "s3cret-operator-token" };

describe("signupTokenAccepted", () => {
  it("accepts the configured token", () => {
    expect(signupTokenAccepted("s3cret-operator-token", CONFIGURED)).toBe(true);
  });

  it("rejects a different token", () => {
    expect(signupTokenAccepted("s3cret-operator-tokes", CONFIGURED)).toBe(false);
  });

  it("is case sensitive", () => {
    expect(signupTokenAccepted("S3CRET-OPERATOR-TOKEN", CONFIGURED)).toBe(false);
  });

  it.each([
    ["a shorter string", "s3cret"],
    ["a longer string", "s3cret-operator-token-and-more"],
    ["an empty string", ""],
  ])("rejects %s without throwing on the length mismatch", (_label, supplied) => {
    expect(signupTokenAccepted(supplied, CONFIGURED)).toBe(false);
  });

  it.each([
    ["unset", {}],
    ["empty", { [SIGNUP_TOKEN_VAR]: "" }],
    ["whitespace", { [SIGNUP_TOKEN_VAR]: "   " }],
  ])("closes signup entirely when the variable is %s", (_label, env: AuthEnv) => {
    // Fail closed. The dangerous reading of "no token configured" is "no token
    // required", which turns a deployment into the open signup SPEC.md §2 rules
    // out. An unconfigured deployment accepts nothing, not everything.
    expect(signupTokenAccepted("", env)).toBe(false);
    expect(signupTokenAccepted("anything", env)).toBe(false);
  });

  it.each([
    ["a missing field", undefined],
    ["a number", 42],
    ["repeated form values", ["a", "b"]],
  ])("rejects %s from the form body", (_label, supplied) => {
    expect(signupTokenAccepted(supplied, CONFIGURED)).toBe(false);
  });
});
