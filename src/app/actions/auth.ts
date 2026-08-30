"use server";

import { redirect } from "next/navigation";

import {
  issueInvite,
  joinWithInvite,
  logIn,
  signUpHousehold,
  type AuthError,
  type AuthResult,
} from "@/lib/auth/service";
import { endSession, requireScope, requireSession, startSession } from "@/lib/auth/session";
import type { FieldErrors } from "@/lib/auth/credentials";

/**
 * Server actions for the auth forms.
 *
 * Next.js treats these as public endpoints — they are reachable by anyone who
 * can POST, not only by the page that renders the form — so each one
 * re-establishes what it needs rather than trusting anything the client sent.
 * `createInviteAction` calls `requireSession()` for exactly that reason.
 */

export type FormState =
  | { readonly message?: string; readonly fieldErrors?: FieldErrors }
  | undefined;

/**
 * Wording is deliberately uniform where the underlying causes should not be
 * distinguishable. `invalid-credentials` covers "no such account" and "wrong
 * password" alike, and the invite message does not say which of used, expired
 * or never-existed applies.
 */
const MESSAGES: Record<AuthError, string> = {
  "invalid-input": "Check the fields below.",
  "invalid-signup-token": "That signup token is not valid for this deployment.",
  "email-taken": "That email address already has an account.",
  "invalid-credentials": "That email address and password do not match an account.",
  "invite-invalid": "This invite link is not valid. It may have been used already, or expired.",
};

function failure(result: Extract<AuthResult<unknown>, { ok: false }>): FormState {
  return { message: MESSAGES[result.error], fieldErrors: result.fieldErrors };
}

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const result = await signUpHousehold({
    householdName: formData.get("householdName"),
    email: formData.get("email"),
    password: formData.get("password"),
    signupToken: formData.get("signupToken"),
  });

  if (!result.ok) return failure(result);

  await startSession(result.value);
  // `redirect` throws, so it must stay outside any try/catch here.
  redirect("/household");
}

export async function logInAction(_state: FormState, formData: FormData): Promise<FormState> {
  const result = await logIn({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.ok) return failure(result);

  await startSession(result.value);
  redirect("/household");
}

export async function joinAction(_state: FormState, formData: FormData): Promise<FormState> {
  const result = await joinWithInvite({
    inviteToken: formData.get("inviteToken"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.ok) return failure(result);

  await startSession(result.value);
  redirect("/household");
}

export async function logOutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

export type InviteState =
  | {
      /**
       * A path, not an absolute URL. The origin is filled in by the browser
       * that is about to display it, so the link never depends on a `Host`
       * header the server did not choose.
       */
      readonly path: string;
      readonly expiresAt: string;
    }
  | undefined;

/**
 * Issue an invite into the caller's own household.
 *
 * The raw token is returned to the caller here and nowhere else — it is not
 * stored, not logged, and `listInvites` does not expose the hash it is checked
 * against.
 */
export async function createInviteAction(): Promise<InviteState> {
  const session = await requireSession();
  const scope = await requireScope();

  const invite = await issueInvite(scope, session.userId);

  return { path: `/join/${invite.token}`, expiresAt: invite.expiresAt.toISOString() };
}
