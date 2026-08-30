/**
 * The environment variables the auth modules actually read.
 *
 * Deliberately not `NodeJS.ProcessEnv`. That type makes `NODE_ENV` required, so
 * a test cannot hand these functions an empty object to mean "this deployment
 * configured nothing" — and that is precisely the case that has to fail closed
 * (see `signup-token.ts`). Narrowing it here also documents the whole set of
 * variables this slice depends on in one place; `process.env` still satisfies
 * it, so callers pass it unchanged.
 */
export type AuthEnv = {
  readonly NODE_ENV?: string;
  readonly SESSION_COOKIE_SECURE?: string;
  readonly HOUSEHOLD_SIGNUP_TOKEN?: string;
};
