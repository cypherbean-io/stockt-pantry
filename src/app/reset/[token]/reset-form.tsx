"use client";

import { useActionState } from "react";

import { resetPasswordAction } from "@/app/actions/auth";
import { Field, FormMessage } from "@/app/_components/fields";
import { Button, LinkButton } from "@/app/_components/ui/button";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";

/**
 * The token rides in a hidden field for the reason `JoinForm` gives: a server
 * action does not know which page posted to it. A tampered value just fails.
 *
 * Once the password has changed the form gives way to a link to sign in —
 * spending the link does not start a session (see `resetPassword`).
 */
export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);

  if (state?.resetFor !== undefined) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-ink wrap-anywhere">
          Password changed for {state.resetFor}. Every device that was signed in to it has been
          signed out.
        </p>
        <LinkButton href="/login" className="w-full">
          Sign in
        </LinkButton>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="resetToken" value={token} />
      <FormMessage state={state} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={state?.fieldErrors?.password}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
