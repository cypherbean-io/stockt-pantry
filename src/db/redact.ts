/**
 * Turning a driver error into one that is safe to let escape.
 *
 * `DrizzleQueryError` formats as `Failed query: <sql>\nparams: <bound values>`.
 * CLAUDE.md forbids logging that string, and rethrowing one counts as logging
 * it — Next's default error handler prints whatever escapes, cause chain
 * included. The bound values are password hashes and invite token hashes in
 * `queries/auth.ts`, and whole recipes and pantry contents everywhere else,
 * which SPEC.md §4 rules out of the logs just as firmly.
 *
 * So the original is dropped entirely rather than attached as `cause`: Node
 * prints the whole chain when it reports an unhandled error. What survives is
 * what CLAUDE.md says to log — the SQLSTATE and the constraint name. That is
 * enough to tell a unique violation from an encoding error from a dropped
 * connection, which is all a caller can act on anyway.
 */

export const UNIQUE_VIOLATION = "23505";

/** The fields postgres.js copies off the wire's ErrorResponse. */
export type PostgresError = { readonly code?: string; readonly constraint_name?: string };

/** Drizzle hangs the driver's error off `cause`; the SQLSTATE is only there. */
export function driverError(error: unknown): PostgresError | null {
  return ((error as { cause?: unknown } | null)?.cause ?? error) as PostgresError | null;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = driverError(error);
  return cause?.code === UNIQUE_VIOLATION && cause?.constraint_name === constraint;
}

/** `label` names the query family, e.g. "Auth query", for the log line. */
export function redacted(label: string, error: unknown): Error {
  const cause = driverError(error);
  const code = cause?.code ?? "unknown";
  const constraint = cause?.constraint_name;
  return new Error(
    `${label} rejected by the database (SQLSTATE ${code}` +
      `${constraint === undefined ? "" : `, constraint ${constraint}`})`,
  );
}

/** Wraps a query with no expected failure mode: everything is redacted. */
export async function guarded<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw redacted(label, error);
  }
}
