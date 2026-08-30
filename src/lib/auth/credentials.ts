import type { FieldErrors, Parsed } from "@/lib/forms";

/**
 * Input rules for the auth forms.
 *
 * The result shapes are shared with every other form parser and live in
 * `@/lib/forms`; they are re-exported here because the auth modules have
 * always imported them from this path.
 */

export type { FieldErrors, Parsed };

/** The longest address SMTP will carry (RFC 5321 §4.5.3.1.3). */
export const MAX_EMAIL_LENGTH = 254;

/**
 * NIST SP 800-63B: length, not composition. Character-class rules push people
 * toward predictable substitutions without adding meaningful entropy, so there
 * are none here — only a floor and a ceiling.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * scrypt's cost does not depend on input length, so this is not about hashing
 * time — it bounds what a single form field can push through the request body.
 */
export const MAX_PASSWORD_LENGTH = 200;

export const MAX_HOUSEHOLD_NAME_LENGTH = 100;

export type Credentials = {
  readonly email: string;
  readonly password: string;
};

/**
 * A sanity check, not RFC 5322 validation — that regex is famously unwritable
 * and rejecting a deliverable address is worse than accepting an undeliverable
 * one. v1 sends no mail (SPEC.md §2), so an address is only ever a login
 * identifier: it has to be one non-empty local part, one `@`, one non-empty
 * domain, and no whitespace to smuggle a header through.
 */
function emailError(value: unknown): string | undefined {
  if (typeof value !== "string") return "Enter an email address.";

  const email = value.trim();
  if (email === "") return "Enter an email address.";
  if (email.length > MAX_EMAIL_LENGTH) return "That email address is too long.";
  if (/\s/.test(email)) return "An email address cannot contain spaces.";
  /**
   * Control and format characters, which `\s` and `trim()` both miss.
   *
   * U+0000 is the one that matters: Postgres cannot store a NUL in a `text`
   * column and rejects the whole statement with SQLSTATE 22021 rather than the
   * unique violation the signup and join paths know how to handle, so it would
   * escape as a 500 from an unauthenticated form. The invisible formatting
   * characters (zero-width joiners, bidi overrides) go with it: an address that
   * does not render as what it is has no legitimate use as a login identifier.
   */
  if (/[\p{Cc}\p{Cf}]/u.test(email)) {
    return "An email address cannot contain control characters.";
  }

  const parts = email.split("@");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return "Enter an email address in the form name@example.com.";
  }
  return undefined;
}

function passwordError(value: unknown): string | undefined {
  if (typeof value !== "string") return "Enter a password.";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

/**
 * Note what this does *not* do: it does not lowercase the address, and it does
 * not trim the password.
 *
 * Lowercasing belongs to Postgres. `user.email` carries
 * `CHECK (email = lower(email))` and is both written and looked up through SQL
 * `lower()`; JS `toLowerCase()` disagrees with it on a few codepoints (U+0130
 * is the classic), and normalising in two places is how you get an account that
 * can be created and then never logged into.
 *
 * Trimming the password would silently discard legitimate leading or trailing
 * characters, producing a passphrase the user cannot re-enter.
 */
export function parseCredentials(input: {
  readonly email: unknown;
  readonly password: unknown;
}): Parsed<Credentials> {
  const errors: Record<string, string> = {};

  const email = emailError(input.email);
  if (email !== undefined) errors.email = email;

  const password = passwordError(input.password);
  if (password !== undefined) errors.password = password;

  // Every bad field at once — reporting one per submission turns a two-mistake
  // form into two round trips.
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      email: (input.email as string).trim(),
      password: input.password as string,
    },
  };
}

export function parseHouseholdName(input: unknown): Parsed<string> {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, errors: { householdName: "Name your household." } };
  }
  const name = input.trim();
  if (name.length > MAX_HOUSEHOLD_NAME_LENGTH) {
    return {
      ok: false,
      errors: { householdName: `Use at most ${MAX_HOUSEHOLD_NAME_LENGTH} characters.` },
    };
  }
  return { ok: true, value: name };
}
