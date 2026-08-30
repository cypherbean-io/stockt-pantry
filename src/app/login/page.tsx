"use client";

import Link from "next/link";
import { useActionState } from "react";

import { logInAction } from "@/app/actions/auth";
import { AuthPage, Field, FormMessage } from "@/app/_components/fields";

export default function LoginPage() {
  const [state, action, pending] = useActionState(logInAction, undefined);

  return (
    <AuthPage title="Sign in">
      <form action={action}>
        <FormMessage state={state} />
        {/*
          No per-field errors on this form on purpose: the server answers a
          bad address and a bad password identically, so pointing at one field
          would be guessing — and would leak which of the two was wrong.
        */}
        <Field label="Email" name="email" type="email" autoComplete="username" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p>
        Joining an existing household? Use the invite link a member sent you. Setting up a new
        household? <Link href="/signup">Start here</Link>.
      </p>
    </AuthPage>
  );
}
