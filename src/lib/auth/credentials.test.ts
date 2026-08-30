import { describe, expect, it } from "vitest";

import {
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  parseCredentials,
  parseHouseholdName,
} from "./credentials";

/**
 * Input rules for the auth forms.
 *
 * These return field errors instead of throwing: unlike a bad quantity
 * (`src/db/validate.ts`), a mistyped password is the expected case and has to
 * render back into the form.
 */

const VALID = { email: "cook@example.com", password: "a sufficiently long passphrase" };

function errorsFor(input: { email: unknown; password: unknown }): Record<string, string> {
  const parsed = parseCredentials(input);
  if (parsed.ok) throw new Error("expected the input to be rejected");
  return parsed.errors;
}

describe("parseCredentials", () => {
  it("accepts an ordinary address and passphrase", () => {
    const parsed = parseCredentials(VALID);

    expect(parsed).toEqual({ ok: true, value: VALID });
  });

  it("trims surrounding whitespace from the address", () => {
    const parsed = parseCredentials({ ...VALID, email: "  cook@example.com\n" });

    expect(parsed.ok && parsed.value.email).toBe("cook@example.com");
  });

  it("leaves the address's case alone, because the database lowercases it", () => {
    // schema.ts: `user.email` has CHECK (email = lower(email)) and is written
    // through SQL `lower()`. JS `toLowerCase()` disagrees with Postgres on a
    // handful of codepoints (U+0130 being the classic), and doing it in both
    // places is how you get a login that fails with no error.
    const parsed = parseCredentials({ ...VALID, email: "COOK@Example.COM" });

    expect(parsed.ok && parsed.value.email).toBe("COOK@Example.COM");
  });

  it("does not trim the password", () => {
    // Leading and trailing spaces are legitimate passphrase characters, and
    // silently dropping them makes a password that cannot be re-entered.
    const parsed = parseCredentials({ ...VALID, password: "  spaces matter here  " });

    expect(parsed.ok && parsed.value.password).toBe("  spaces matter here  ");
  });

  it.each([
    ["an empty address", ""],
    ["whitespace only", "   "],
    ["no at sign", "cook.example.com"],
    ["nothing before the at sign", "@example.com"],
    ["nothing after the at sign", "cook@"],
    ["two at signs", "cook@@example.com"],
    ["an embedded space", "co ok@example.com"],
    ["an embedded newline", "cook@example.com\nBcc: someone@else.test"],
    // Postgres cannot store a NUL in a text column and rejects the whole
    // statement with SQLSTATE 22021 — not the unique violation the signup and
    // join paths know how to handle, so it escapes as a 500. `trim()` does not
    // strip it and it is not `\s`, so it needs its own guard.
    ["a NUL byte", `co${"\u0000"}ok@example.com`],
    ["a C0 control character", `cook${"\u0007"}@example.com`],
    ["a zero-width joiner", `co${"\u200d"}ok@example.com`],
    ["a right-to-left override", `cook@${"\u202e"}example.com`],
  ])("rejects %s", (_label, email) => {
    expect(errorsFor({ ...VALID, email })).toHaveProperty("email");
  });

  it("rejects an address longer than an SMTP address can be", () => {
    const email = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;

    expect(errorsFor({ ...VALID, email })).toHaveProperty("email");
  });

  it("rejects a password shorter than the minimum", () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH - 1);

    expect(errorsFor({ ...VALID, password })).toHaveProperty("password");
  });

  it("accepts a password of exactly the minimum length", () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH);

    expect(parseCredentials({ ...VALID, password }).ok).toBe(true);
  });

  it("rejects a password long enough to be a denial-of-service payload", () => {
    const password = "a".repeat(MAX_PASSWORD_LENGTH + 1);

    expect(errorsFor({ ...VALID, password })).toHaveProperty("password");
  });

  it("imposes no character-class rules, only length", () => {
    // NIST SP 800-63B: length over composition. Complexity rules push users
    // toward predictable substitutions without adding real entropy.
    expect(parseCredentials({ ...VALID, password: "aaaaaaaaaaaaaaaaaaaa" }).ok).toBe(true);
  });

  it("reports every bad field at once rather than one per submission", () => {
    const errors = errorsFor({ email: "nope", password: "short" });

    expect(Object.keys(errors).sort()).toEqual(["email", "password"]);
  });

  it.each([
    ["a missing field", undefined],
    ["a number", 42],
    ["a file upload", new Blob([])],
    ["an array of values", ["a@b.co", "c@d.co"]],
  ])("rejects %s from the form body without throwing", (_label, email) => {
    // FormData.get() is typed `FormDataEntryValue | null`, and a crafted body
    // can send repeats or a file for any field.
    expect(errorsFor({ email, password: VALID.password })).toHaveProperty("email");
  });
});

describe("parseHouseholdName", () => {
  it("accepts and trims a name", () => {
    expect(parseHouseholdName("  The Kitchen  ")).toEqual({ ok: true, value: "The Kitchen" });
  });

  it("rejects an empty name", () => {
    expect(parseHouseholdName("   ").ok).toBe(false);
  });

  it("rejects a name that is not a string", () => {
    expect(parseHouseholdName(undefined).ok).toBe(false);
  });

  it("rejects an unreasonably long name", () => {
    expect(parseHouseholdName("x".repeat(1000)).ok).toBe(false);
  });
});
