"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signUpAction } from "@/app/actions/auth";
import { AuthPage, Field, FormMessage } from "@/app/_components/fields";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";

/**
 * Creating a household (SPEC.md §2: not public signup — the deployment's
 * operator holds a token and hands it out).
 *
 * The form is reachable without one; the token is what the server checks, so
 * hiding the page would only be decoration.
 */
export default function SignupPage() {
  const [state, action, pending] = useActionState(signUpAction, undefined);

  return (
    <AuthPage title="Create a household">
      <form action={action}>
        <FormMessage state={state} />
        <Field
          label="Signup token"
          name="signupToken"
          type="password"
          autoComplete="off"
          hint="Ask whoever runs this deployment. Joining an existing household needs an invite link instead."
        />
        <Field
          label="Household name"
          name="householdName"
          error={state?.fieldErrors?.householdName}
        />
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
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Length is all that is checked — a passphrase is fine.`}
          error={state?.fieldErrors?.password}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create household"}
        </button>
      </form>

      <p>
        Already have an account? <Link href="/login">Sign in</Link>.
      </p>
    </AuthPage>
  );
}
