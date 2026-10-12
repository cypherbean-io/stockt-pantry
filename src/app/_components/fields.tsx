import type { ReactNode } from "react";

import type { FormState } from "@/app/actions/auth";

import { Card } from "./ui/card";
import { controlClass, describedBy, Field as FieldShell, FormMessage as Message } from "./ui/field";
import { PageHeader } from "./ui/page-header";

/**
 * The bits of form markup the three auth pages share.
 *
 * Server Components: they render inside client pages but hold no state
 * themselves, and nothing here reads a cookie or touches the database.
 *
 * Since SPEC.md §3.6 these are adapters over `ui/field.tsx` rather than markup
 * of their own. They keep their signatures — `<Field label name type>` and
 * `<FormMessage state>` — so `/login`, `/signup` and `/join/[token]` did not
 * have to change to adopt them, and the `#b00020` that used to be inlined here
 * is gone: the error colour is `--status-gap-ink`, which has a dark variant
 * and a contrast assertion behind it.
 */

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  error,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
}) {
  // The field's id is its name, as it was before; `describedBy` derives the
  // hint and error ids from it and `FieldShell` renders them under those ids.
  return (
    <FieldShell id={name} label={label} hint={hint} error={error}>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        className={controlClass}
        {...describedBy(name, { hint: hint !== undefined, error })}
      />
    </FieldShell>
  );
}

/** The form-level message, distinct from the per-field ones. */
export function FormMessage({ state }: { state: FormState }) {
  return <Message message={state?.message} />;
}

/**
 * No `<main>` of its own since SPEC.md §3.3: the shell renders the app's one
 * `<main>`, and a second one nested inside it is invalid markup that the "skip
 * to content" affordance ignores.
 *
 * The form sits on a card in the shell's narrow signed-out column; `footer` is
 * for the way to the *other* door — sign in, set up a household — which is
 * not part of the form and so sits under the card rather than inside it.
 */
export function AuthPage({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>{children}</Card>
      {footer !== undefined && (
        <div className="mt-6 flex flex-col gap-3 text-sm text-ink-muted">{footer}</div>
      )}
    </>
  );
}
