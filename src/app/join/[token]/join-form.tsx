"use client";

import { useActionState } from "react";

import { joinAction } from "@/app/actions/auth";
import { Field, FormMessage } from "@/app/_components/fields";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";

/**
 * The token rides in a hidden field rather than being read from the URL on the
 * server side of the action: a server action is a plain POST endpoint with no
 * knowledge of which page submitted it. It is re-checked on redemption
 * regardless, so a tampered value just fails.
 */
export function JoinForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(joinAction, undefined);

  return (
    <form action={action}>
      <input type="hidden" name="inviteToken" value={token} />
      <FormMessage state={state} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        error={state?.fieldErrors?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={state?.fieldErrors?.password}
      />
      <button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join household"}
      </button>
    </form>
  );
}
