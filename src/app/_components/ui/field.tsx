import type { ReactElement, ReactNode } from "react";

/**
 * The form primitives the auth forms and the pantry forms share
 * (SPEC.md §3.6).
 *
 * `Field` wraps a control rather than rendering one. The auth forms need a
 * required text input, the pantry needs a number input with a decimal step and
 * a grouped select, and the import review screen needs something else again;
 * bending one component to cover all of them would take more props than any of
 * those forms has fields. What they genuinely share is the *wiring* — label,
 * hint, error, and the `aria-*` attributes tying the three together — and that
 * is what lives here.
 *
 * That wiring is worth centralising precisely because it is invisible. A
 * control whose `aria-describedby` points at an id that is not on the page
 * looks identical to one that works, and the only person who finds out is the
 * one using a screen reader.
 */

/**
 * The look of any text input, number input or select in the app.
 *
 * `text-base` is 1rem and load-bearing: iOS zooms the viewport on focus for
 * anything under 16px, which SPEC.md §1 names as one of the concrete reasons
 * the app is unusable on a phone today. `min-h-tap` is the 44px target of
 * §2.9. The invalid border follows `aria-invalid` rather than a second prop,
 * so a control cannot end up looking fine while announcing itself as broken.
 */
export const controlClass =
  "min-h-tap w-full rounded-control border border-border-strong bg-surface-raised px-3 py-2 " +
  "text-base text-ink motion-safe:transition-colors focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-focus aria-invalid:border-status-gap-ink";

/**
 * The `aria-*` pair a control repeats for every hint and error beside it.
 *
 * Both ids, in reading order, not just the error: the density hint is the only
 * place the app explains a genuinely surprising rule — that a blank density
 * makes a comparison report "can't verify" rather than missing — and dropping
 * it from the description hides it from anyone not reading the screen.
 */
export function describedBy(
  id: string,
  { hint = false, error }: { readonly hint?: boolean; readonly error?: string },
): {
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
} {
  const described = [hint ? `${id}-hint` : undefined, error !== undefined ? `${id}-error` : undefined]
    .filter((value): value is string => value !== undefined)
    .join(" ");

  return {
    "aria-describedby": described === "" ? undefined : described,
    "aria-invalid": error === undefined ? undefined : true,
  };
}

/**
 * Nothing at all when there is no error — not an empty element. An id that
 * exists but holds no text makes a screen reader announce a description of "".
 */
export function FieldError({
  id,
  error,
}: {
  readonly id: string;
  readonly error?: string;
}): ReactElement | null {
  if (error === undefined) return null;

  return (
    // A `<span class="block">` rather than a paragraph, because not every
    // control in the app is inside a `Field`: the pantry's ingredient picker
    // renders its own error inside the <p> that holds its label and select,
    // and a <p> nested in a <p> is markup the browser closes early.
    //
    // `role="alert"` because the error arrives on submit, by which point focus
    // has left the field: without a live region nothing is announced and the
    // form simply fails to advance.
    <span
      id={`${id}-error`}
      role="alert"
      className="block text-sm font-medium text-status-gap-ink"
    >
      {error}
    </span>
  );
}

/**
 * The form-level message, distinct from the per-field ones. "Email or password
 * is wrong" belongs to the form, because naming which of the two was wrong
 * would leak whether the address exists.
 */
export function FormMessage({ message }: { readonly message?: string }): ReactElement | null {
  if (message === undefined) return null;

  return (
    <p
      role="alert"
      className="rounded-control bg-status-gap px-3 py-2 text-sm font-medium text-status-gap-ink"
    >
      {message}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  /** The control's own id. Every other id on the field is derived from it. */
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <FieldError id={id} error={error} />
    </div>
  );
}
