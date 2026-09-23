import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu, ACCOUNT_PANEL_ID, AccountPanel } from "./account-menu";

/**
 * The account disclosure of SPEC.md §3.3.
 *
 * It exists to hold two things that were previously reachable from exactly one
 * screen — the signed-in email, and Sign out — without putting either on the
 * always-visible bar. SPEC.md §3.3 is explicit about why: the email on the bar
 * would be in every screenshot and every over-the-shoulder glance of every
 * page, and collapsing it keeps it one click away without that.
 *
 * So the assertion that matters most here is a negative one. The panel is
 * rendered only while it is open, which means the email is not merely hidden
 * with CSS — it is not in the HTML of a page nobody opened the menu on.
 */

const EMAIL = "someone@example.test";

function triggerOf(markup: string): string {
  return /<button[^>]*>/.exec(markup)?.[0] ?? "";
}

describe("the collapsed account menu", () => {
  it("does not put the signed-in email on the bar", () => {
    // The whole reason the disclosure exists (SPEC.md §3.3, §4).
    expect(renderToStaticMarkup(<AccountMenu email={EMAIL} />)).not.toContain(EMAIL);
  });

  it("does not ship Sign out where a stray click can reach it", () => {
    expect(renderToStaticMarkup(<AccountMenu email={EMAIL} />)).not.toContain("Sign out");
  });

  it("tells assistive technology it is a disclosure and that it is shut", () => {
    expect(triggerOf(renderToStaticMarkup(<AccountMenu email={EMAIL} />))).toContain(
      'aria-expanded="false"',
    );
  });

  it("does not claim to control a panel that is not in the document", () => {
    // `aria-controls` pointing at an absent id is a dangling reference. The
    // attribute appears with the panel and not before it.
    expect(renderToStaticMarkup(<AccountMenu email={EMAIL} />)).not.toContain("aria-controls");
  });

  it("has a name, even though it is drawn as a glyph", () => {
    // Every icon in `icons.tsx` is `aria-hidden`, deliberately — they sit
    // beside text everywhere else. Here there is no text beside it, so without
    // a label the control announces as "button".
    expect(triggerOf(renderToStaticMarkup(<AccountMenu email={EMAIL} />))).toMatch(
      /aria-label="[^"]+"/,
    );
  });

  it("does not submit the page it sits on", () => {
    expect(triggerOf(renderToStaticMarkup(<AccountMenu email={EMAIL} />))).toContain(
      'type="button"',
    );
  });
});

describe("the opened account menu", () => {
  it("shows which account you are signed in as", () => {
    expect(renderToStaticMarkup(<AccountPanel email={EMAIL} />)).toContain(EMAIL);
  });

  it("offers a way out from anywhere in the app", () => {
    // Today Sign out exists at the bottom of /household under an <h2>Session</h2>
    // and nowhere else (SPEC.md §1).
    expect(renderToStaticMarkup(<AccountPanel email={EMAIL} />)).toContain("Sign out");
  });

  it("signs out through a form rather than a link", () => {
    // A GET link that ends a session is signed out by anything that follows
    // links — a prefetch, a scanner, an email client warming a preview. Sign
    // out is a submit button inside a form posting the existing `logOutAction`.
    const markup = renderToStaticMarkup(<AccountPanel email={EMAIL} />);

    expect(markup).toMatch(/<form[^>]*>[\s\S]*Sign out[\s\S]*<\/form>/);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>\s*Sign out|Sign out\s*<\/button>/);
    expect(markup).not.toMatch(/<a[^>]*>\s*Sign out/);
  });

  it("keeps household settings reachable now that the link lines are gone", () => {
    expect(renderToStaticMarkup(<AccountPanel email={EMAIL} />)).toContain('href="/household"');
  });

  it("is the panel the trigger says it controls", () => {
    expect(renderToStaticMarkup(<AccountPanel email={EMAIL} />)).toContain(
      `id="${ACCOUNT_PANEL_ID}"`,
    );
  });

  it("does not let a long address stretch the header", () => {
    // An address is arbitrary length and the panel is anchored to the right
    // edge of a 375px screen.
    const markup = renderToStaticMarkup(<AccountPanel email={"a".repeat(80) + "@example.test"} />);

    expect(markup).toContain("truncate");
  });
});
