/**
 * Login throttling: how many password checks one address gets, and over what
 * window.
 *
 * The counter is a Postgres row (`recordLoginAttempt` in
 * `src/db/queries/auth.ts`) rather than process memory, so every replica
 * draws on the same budget and a restart does not hand out a fresh one. It is
 * keyed by the address as submitted, whether or not an account has it — an
 * address that only locks once it exists would be an enumeration oracle.
 *
 * What is deliberately *not* here is a per-client limit. Nothing in front of
 * the app is known to set a trustworthy client address, and an
 * `X-Forwarded-For` the caller wrote themselves is a limit they choose.
 *
 * The cost of keying on the address is that anyone who knows an address can
 * keep it locked: `LOGIN_MAX_ATTEMPTS` requests per window, every window, for
 * as long as they care to — the owner's own attempt is then the one too many. Signed-in sessions are unaffected; signing in
 * anew is not, and there is no unlock path. Nothing here mitigates that — the
 * fix is a per-device allowance for browsers that have signed in before
 * (OWASP's "device cookie"), which needs a signing secret this deployment
 * does not yet have.
 */

/**
 * At 10 per 15 minutes an attacker gets under a thousand guesses a day at any
 * one address, against passwords of at least `MIN_PASSWORD_LENGTH`. Loose
 * enough that someone fumbling their own password on a phone keyboard does not
 * notice it.
 */
export const LOGIN_MAX_ATTEMPTS = 10;

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * A window that started at or before this instant has run out, and the next
 * attempt opens a fresh one. Fixed rather than sliding, so attempts made while
 * an address is shut do not hold it shut any longer — though a fresh burst in
 * the next window shuts it again (see above). The price is that up to twice
 * the limit can land either side of a window boundary.
 */
export function loginWindowCutoff(now: Date): Date {
  return new Date(now.getTime() - LOGIN_WINDOW_MS);
}

/**
 * `attempts` includes the one being made — it is counted before the password
 * is checked, which is what stops a burst of simultaneous requests all reading
 * the same count and all getting through.
 */
export function loginAttemptAllowed(attempts: number): boolean {
  return attempts <= LOGIN_MAX_ATTEMPTS;
}
