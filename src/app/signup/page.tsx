"use client";

import { useActionState } from "react";

import { signUpAction } from "@/app/actions/auth";
import { AuthPage, Field, FormMessage } from "@/app/_components/fields";
import { Button, LinkButton } from "@/app/_components/ui/button";
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
    <AuthPage
      title="Create a household"
      footer={
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
          Already have an account?
          <LinkButton href="/login" variant="secondary" size="sm">
            Sign in
          </LinkButton>
        </p>
      }
    >
      <form action={action} className="flex flex-col gap-4">
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
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating…" : "Create household"}
        </Button>
      </form>
    </AuthPage>
  );
}
