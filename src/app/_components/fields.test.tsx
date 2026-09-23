import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field } from "./fields";

/**
 * The auth forms' field, which since SPEC.md §3.6 is an adapter over
 * `ui/field.tsx` rather than markup of its own.
 *
 * What is worth asserting about an adapter is the join. `ui/field.tsx` renders
 * the hint and the error under derived ids, and `describedBy` builds the list
 * of ids the control points at — separately, from separate arguments. Pass the
 * hint to one and not the other and the control announces a description that
 * is not on the page. Nothing renders differently, nothing throws, and the only
 * person who finds out is using a screen reader.
 */

/** Ids an `aria-describedby` promises that no element in the markup carries. */
function danglingDescriptions(markup: string): readonly string[] {
  return [...markup.matchAll(/aria-describedby="([^"]*)"/g)]
    .flatMap((match) => (match[1] ?? "").split(" "))
    .filter((id) => id !== "" && !markup.includes(`id="${id}"`));
}

describe("an auth field", () => {
  it("points at a hint it actually renders", () => {
    const markup = renderToStaticMarkup(
      <Field label="Password" name="password" hint="At least 12 characters." />,
    );

    expect(danglingDescriptions(markup)).toEqual([]);
    expect(markup).toContain('id="password-hint"');
  });

  it("points at the hint and the error together once the form comes back", () => {
    const markup = renderToStaticMarkup(
      <Field label="Password" name="password" hint="At least 12 characters." error="Too short" />,
    );

    expect(danglingDescriptions(markup)).toEqual([]);
    expect(markup).toContain('aria-describedby="password-hint password-error"');
  });

  it("describes nothing when there is nothing to describe", () => {
    // `/login` renders both its fields this way on purpose: the server answers
    // a bad address and a bad password identically, so there is no per-field
    // error to point at and an empty description would be noise.
    const markup = renderToStaticMarkup(<Field label="Email" name="email" type="email" />);

    // The trailing `="` matters: `controlClass` carries an
    // `aria-invalid:border-status-gap-ink` variant, which is a class name that
    // reacts to the attribute rather than the attribute itself.
    expect(markup).not.toContain('aria-describedby="');
    expect(markup).not.toContain('aria-invalid="');
  });
});
