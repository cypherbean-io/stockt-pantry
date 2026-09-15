import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, BUTTON_SIZES, BUTTON_VARIANTS, buttonClass, LinkButton } from "./button";

/**
 * SPEC.md §3.6: `Button` (primary/secondary/ghost/danger, sm/md) and
 * `LinkButton`.
 *
 * Two of the assertions below are requirements from elsewhere in the spec
 * rather than opinions about buttons — the 44px touch target of §2.9, which
 * §5's mobile smoke spec measures, and a focus ring, without which the whole
 * app is unusable from a keyboard. They are cheap to state here and expensive
 * to discover in a kitchen.
 */

function classOf(markup: string): string {
  return /class="([^"]*)"/.exec(markup)?.[1] ?? "";
}

describe("a button", () => {
  it("stays inert inside a form unless it is asked to submit one", () => {
    // HTML defaults a typeless <button> to type="submit". A Remove button, a
    // disclosure toggle or a Copy button dropped into a form would then submit
    // it — and this app puts buttons inside forms on nearly every screen.
    expect(renderToStaticMarkup(<Button>Copy</Button>)).toContain('type="button"');
  });

  it("submits when the caller says so", () => {
    expect(renderToStaticMarkup(<Button type="submit">Sign in</Button>)).toContain(
      'type="submit"',
    );
  });

  it("passes disabled through, so a pending action cannot be fired twice", () => {
    // Every form in this app already renders `disabled={pending}` from
    // useActionState; a wrapper that swallowed the prop would re-enable
    // double submission everywhere at once.
    expect(renderToStaticMarkup(<Button disabled>Saving…</Button>)).toContain("disabled");
  });

  it.each(BUTTON_SIZES)("keeps a %s button at the touch target a phone needs", (size) => {
    // SPEC.md §2.9 puts every interactive target at >= 44x44 CSS px, and
    // `--spacing-tap` is that number named. A small button is smaller in text
    // and padding, never in how easy it is to hit.
    expect(buttonClass({ size })).toContain("min-h-tap");
    expect(buttonClass({ size })).toContain("min-w-tap");
  });

  it.each(BUTTON_SIZES)("shows a %s button's keyboard focus", (size) => {
    expect(buttonClass({ size })).toContain("outline-focus");
  });

  it("will not compile with raw HTML in it", () => {
    // Same mechanism as the LinkButton assertion below. `Button` spreads the
    // caller's props onto the element, so `dangerouslySetInnerHTML` would be
    // forwarded if the type allowed it — and this is the component every
    // screen renders. `src/` has no raw-HTML sink anywhere; this is what keeps
    // that true without anyone having to spot it in a diff.
    // @ts-expect-error dangerouslySetInnerHTML is omitted from Button's props.
    const rejected = <Button dangerouslySetInnerHTML={{ __html: "<img src=x onerror=alert(1)>" }} />;

    expect(rejected).toBeDefined();
  });

  it("gives every variant a look of its own", () => {
    // Guards the copy-paste where two variants end up with the same body and
    // the distinction the call sites are making silently disappears.
    const looks = BUTTON_VARIANTS.map((variant) => buttonClass({ variant }));

    expect(new Set(looks).size).toBe(BUTTON_VARIANTS.length);
  });
});

describe("a link button", () => {
  it("is a link, so it can be opened in a new tab and shows where it goes", () => {
    // "Add a recipe" is navigation wearing a button's clothes. Rendering it as
    // a <button> would lose middle-click, the status bar and the back button.
    const markup = renderToStaticMarkup(<LinkButton href="/recipes/new">Add a recipe</LinkButton>);

    expect(markup).toMatch(/^<a\b/);
    expect(markup).toContain('href="/recipes/new"');
  });

  it("will not compile with an off-site destination", () => {
    // Enforced by `npm run typecheck`, not by vitest: an unused
    // `@ts-expect-error` is itself a compile error, so widening `href` back to
    // `string` fails the build here rather than passing silently. An external
    // link needs `rel="noopener noreferrer"` and a scheme check, and this is
    // the component someone would otherwise reach for when wiring up a
    // recipe's imported `sourceUrl`.
    // @ts-expect-error LinkButton takes an internal route, not an absolute URL.
    const rejected = <LinkButton href="https://evil.example/x">Open the original</LinkButton>;

    expect(rejected).toBeDefined();
  });

  it("is styled exactly like the button it stands in for", () => {
    // The point of the pair is that a reader cannot tell which is which.
    const link = classOf(
      renderToStaticMarkup(
        <LinkButton href="/pantry" variant="secondary" size="sm">
          Your pantry
        </LinkButton>,
      ),
    );
    const button = classOf(
      renderToStaticMarkup(
        <Button variant="secondary" size="sm">
          Your pantry
        </Button>,
      ),
    );

    expect(link).toBe(button);
  });
});
