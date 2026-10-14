"use client";

import { useState, type ReactElement } from "react";

import { Button } from "./ui/button";
import { cx } from "./ui/class-names";
import { controlClass, describedBy, Field } from "./ui/field";

/**
 * Copy to clipboard on the shopping list (SPEC.md §3.8).
 *
 * `navigator.clipboard` only exists in a secure context, and a self-hosted
 * deployment on `http://192.168.x.x:3000` is not one. So the click
 * feature-detects, and when the clipboard is absent — or present but refuses
 * the write — the text goes into a pre-selected, read-only text box instead of
 * the click throwing or quietly doing nothing.
 *
 * It only ever runs on an explicit click (SPEC.md §4): the shopping list is
 * household data, and nothing reaches the system clipboard until someone asks
 * for it. (`text` itself does travel in the page's server-component payload,
 * as every prop of a Client Component does — it holds nothing the list above
 * it does not already show.) It reads; it never writes to the pantry.
 */

export type CopyOutcome = "copied" | "fallback";

/**
 * The decision, apart from React, so every branch is testable without a
 * browser. `undefined` is what a non-secure context hands over.
 */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
): Promise<CopyOutcome> {
  if (clipboard === undefined) return "fallback";

  try {
    await clipboard.writeText(text);
    return "copied";
  } catch {
    // Permission refused, or the document lost focus before the write. The
    // reason is the browser's business; the user still needs the text.
    return "fallback";
  }
}

export function CopyButton({ text }: { readonly text: string }): ReactElement {
  const [outcome, setOutcome] = useState<CopyOutcome | undefined>(undefined);

  async function copy(): Promise<void> {
    // Typed as always present; outside a secure context it is not.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    setOutcome(await copyText(text, clipboard));
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          Copy
        </Button>
        {/* Always on the page, so the announcement is not lost to a region
            that appeared in the same render as its text. */}
        <p role="status" className="text-sm text-ink-muted">
          {outcome === "copied" ? "Copied to the clipboard." : ""}
        </p>
      </div>

      {outcome === "fallback" && <ClipboardFallback text={text} />}
    </div>
  );
}

const FALLBACK_ID = "shopping-list-copy";

/**
 * Its own export so it can be rendered without a click, as `IssuedInvite` is.
 *
 * `text-base` stays from `controlClass`: focus lands here, and iOS zooms the
 * viewport on focus for anything under 16px.
 */
export function ClipboardFallback({ text }: { readonly text: string }): ReactElement {
  return (
    <div className="w-full">
      <Field
        id={FALLBACK_ID}
        label="Select all and copy"
        hint="This browser would not let the page copy for you, so the list is here to copy by hand."
      >
        <textarea
          id={FALLBACK_ID}
          readOnly
          rows={text.split("\n").length}
          value={text}
          className={cx(controlClass, "font-mono")}
          // Pre-selected on arrival, so one copy keystroke is all it takes.
          ref={(element) => {
            element?.focus();
            element?.select();
          }}
          {...describedBy(FALLBACK_ID, { hint: true })}
        />
      </Field>
    </div>
  );
}
