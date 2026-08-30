import { timingSafeEqual } from "node:crypto";

import type { AuthEnv } from "./env";
import { hashToken } from "./token";

/**
 * The gate on creating a *household* (SPEC.md §2 puts public/open signup out of
 * scope for v1, while still wanting one deployment to serve many independent
 * households).
 *
 * The operator sets one deployment-level secret and hands it out when they want
 * a new household to exist. Joining an *existing* household does not go through
 * here at all — that is what invites are for.
 */

export const SIGNUP_TOKEN_VAR = "HOUSEHOLD_SIGNUP_TOKEN";

/**
 * Fails closed. The tempting reading of "no token configured" is "no token
 * required", which is exactly the open signup SPEC.md §2 rules out — and it
 * would be the default state of a fresh deployment. An unconfigured deployment
 * accepts nothing.
 *
 * Both sides are hashed before comparison so `timingSafeEqual` always gets
 * equal-length buffers: it throws on a length mismatch, and a `.length` check
 * to avoid that would itself leak the configured token's length.
 */
export function signupTokenAccepted(
  supplied: unknown,
  env: AuthEnv = process.env,
): boolean {
  const configured = env[SIGNUP_TOKEN_VAR];
  if (typeof configured !== "string" || configured.trim() === "") return false;
  if (typeof supplied !== "string") return false;

  return timingSafeEqual(
    Buffer.from(hashToken(supplied), "hex"),
    Buffer.from(hashToken(configured), "hex"),
  );
}
