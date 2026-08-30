import type { ReactNode } from "react";

import type { FormState } from "@/app/actions/auth";

/**
 * The bits of form markup the three auth pages share.
 *
 * Server Components: they render inside client pages but hold no state
 * themselves, and nothing here reads a cookie or touches the database.
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
  return (
    <p style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-describedby={error === undefined ? undefined : `${name}-error`}
        aria-invalid={error === undefined ? undefined : true}
      />
      {hint !== undefined && <small>{hint}</small>}
      {error !== undefined && (
        <small id={`${name}-error`} role="alert" style={{ color: "#b00020" }}>
          {error}
        </small>
      )}
    </p>
  );
}

/** The form-level message, distinct from the per-field ones. */
export function FormMessage({ state }: { state: FormState }) {
  if (state?.message === undefined) return null;
  return (
    <p role="alert" style={{ color: "#b00020" }}>
      {state.message}
    </p>
  );
}

export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
