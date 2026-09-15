import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { controlClass, describedBy, Field, FieldError, FormMessage } from "./field";

/**
 * SPEC.md §3.6: `Field`, `FieldError`, `FormMessage`, shared by the auth forms
 * and the pantry forms.
 *
 * Nearly every assertion here is about the wiring between a control and the
 * text explaining it, because that wiring is invisible: a field whose
 * `aria-describedby` points at nothing looks identical to one that works, and
 * the only person who finds out is using a screen reader.
 */

describe("a field error", () => {
  it("renders nothing at all when there is no error", () => {
    // Not an empty element: `aria-describedby` on the control points at this
    // id, and an id that exists but is empty makes a screen reader announce a
    // description of "".
    expect(renderToStaticMarkup(<FieldError id="email" />)).toBe("");
  });

  it("carries the id the control's aria-describedby names", () => {
    expect(renderToStaticMarkup(<FieldError id="email" error="Enter an address" />)).toContain(
      'id="email-error"',
    );
  });

  it("announces itself, because it appears after the user has moved on", () => {
    // The error arrives on submit, by which point focus has left the field.
    // Without a live region nothing is said and the form just fails to advance.
    expect(renderToStaticMarkup(<FieldError id="email" error="Enter an address" />)).toContain(
      'role="alert"',
    );
  });

  it("is phrasing content, so it is valid everywhere a control already is", () => {
    // Not every control in the app sits inside a `Field` — the ingredient
    // picker on the pantry add form puts its own error inside the <p> holding
    // the label and select. A <p> nested in a <p> is markup the browser closes
    // early, which silently reflows the form around it.
    expect(renderToStaticMarkup(<FieldError id="email" error="Enter an address" />)).toMatch(
      /^<span\b/,
    );
  });
});

describe("describing a control", () => {
  it("points at the hint when that is all there is", () => {
    // The density hint — "leave it blank and those comparisons report can't
    // verify" — is the only place the app explains a genuinely surprising
    // rule. Leaving it out of the description hides it from anyone not
    // reading the screen.
    expect(describedBy("densityGPerMl", { hint: true })).toEqual({
      "aria-describedby": "densityGPerMl-hint",
      "aria-invalid": undefined,
    });
  });

  it("points at the hint and the error together, in reading order", () => {
    expect(describedBy("densityGPerMl", { hint: true, error: "Not a number" })).toEqual({
      "aria-describedby": "densityGPerMl-hint densityGPerMl-error",
      "aria-invalid": true,
    });
  });

  it("marks a control invalid only once it actually has an error", () => {
    expect(describedBy("email", {})).toEqual({
      "aria-describedby": undefined,
      "aria-invalid": undefined,
    });
  });
});

describe("a field", () => {
  it("binds its label to the control the caller passed in", () => {
    const markup = renderToStaticMarkup(
      <Field id="email" label="Email">
        <input id="email" name="email" />
      </Field>,
    );

    expect(markup).toContain('for="email"');
  });

  it("leaves the hint out entirely rather than rendering an empty one", () => {
    const markup = renderToStaticMarkup(
      <Field id="email" label="Email">
        <input id="email" name="email" />
      </Field>,
    );

    expect(markup).not.toContain("email-hint");
  });

  it("gives the hint the id describedBy promised", () => {
    const markup = renderToStaticMarkup(
      <Field id="densityGPerMl" label="Density" hint="Only needed to compare weight to volume.">
        <input id="densityGPerMl" name="densityGPerMl" />
      </Field>,
    );

    expect(markup).toContain('id="densityGPerMl-hint"');
  });
});

describe("a form message", () => {
  it("says nothing when the form has nothing to say", () => {
    expect(renderToStaticMarkup(<FormMessage />)).toBe("");
  });

  it("announces a form-level failure", () => {
    // "Email or password is wrong" belongs to the form, not to either field —
    // saying which one was wrong would leak whether the address exists.
    const markup = renderToStaticMarkup(<FormMessage message="Email or password is wrong" />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Email or password is wrong");
  });
});

describe("the shared control style", () => {
  it("sets text at 16px, below which iOS zooms the viewport on focus", () => {
    // SPEC.md §1 names this as one of the concrete reasons the app is not
    // usable on a phone today. `text-base` is 1rem; anything smaller and every
    // tap into a field jerks the page.
    expect(controlClass).toContain("text-base");
  });

  it("meets the touch target a phone needs", () => {
    expect(controlClass).toContain("min-h-tap");
  });

  it("shows keyboard focus", () => {
    expect(controlClass).toContain("outline-focus");
  });

  it("marks itself when the control reports aria-invalid", () => {
    // The invalid border follows the ARIA state rather than a second prop, so
    // a control cannot end up looking fine while announcing itself as broken.
    expect(controlClass).toContain("aria-invalid:");
  });
});
