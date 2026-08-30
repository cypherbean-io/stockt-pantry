/**
 * What a form parser hands back.
 *
 * These live outside any one feature because more than one form produces them
 * and they all feed the same `Field`/`FormMessage` components —
 * `src/lib/auth/credentials.ts` and `src/lib/pantry/entry.ts` are the current
 * producers.
 *
 * Field errors rather than exceptions, unlike `src/db/validate.ts`: a mistyped
 * quantity is the expected case and has to render back into the form the user
 * is looking at, whereas reaching the validator with a bad value from
 * elsewhere in the app is a bug and should throw.
 */

export type FieldErrors = Readonly<Record<string, string>>;

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: FieldErrors };
