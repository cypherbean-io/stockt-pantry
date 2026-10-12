"use client";

import { useActionState } from "react";

import { logInAction } from "@/app/actions/auth";
import { AuthPage, Field, FormMessage } from "@/app/_components/fields";
import { Button, LinkButton } from "@/app/_components/ui/button";

export default function LoginPage() {
  const [state, action, pending] = useActionState(logInAction, undefined);

  return (
    <AuthPage
      title="Sign in"
      footer={
        <>
          <p>Joining an existing household? Use the invite link a member sent you.</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Setting up a new household?
            <LinkButton href="/signup" variant="secondary" size="sm">
              Start here
            </LinkButton>
          </p>
        </>
      }
    >
      <form action={action} className="flex flex-col gap-4">
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
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthPage>
  );
}
