import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ClipboardFallback, CopyButton, copyText } from "./copy-button";

/**
 * Copy to clipboard on the shopping list (SPEC.md §3.8).
 *
 * The decision — clipboard or fallback — is `copyText`, and it takes the
 * clipboard as an argument so every branch runs here in Node with no browser.
 * The click itself, and what actually lands on the system clipboard, is
 * `e2e/clipboard.spec.ts` (SPEC.md §5 Smoke 7).
 */

const TEXT = "Chana masala — shopping list (4 servings)\n- Chickpeas: 240 g\n- Tomatoes: 400 g";

describe("copyText", () => {
  it("writes the exact text when the clipboard is there", async () => {
    const writeText = vi.fn(() => Promise.resolve());

    await expect(copyText(TEXT, { writeText })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(TEXT);
  });

  it("falls back when there is no clipboard at all", async () => {
    // `navigator.clipboard` is undefined outside a secure context — which a
    // self-hosted `http://192.168.x.x:3000` is.
    await expect(copyText(TEXT, undefined)).resolves.toBe("fallback");
  });

  it("falls back when the browser refuses the write", async () => {
    // Permission denied, or the document lost focus between click and write.
    const writeText = vi.fn(() => Promise.reject(new DOMException("denied", "NotAllowedError")));

    await expect(copyText(TEXT, { writeText })).resolves.toBe("fallback");
  });

  it("falls back when the write throws before it returns a promise", async () => {
    const writeText = vi.fn((): Promise<void> => {
      throw new TypeError("Illegal invocation");
    });

    await expect(copyText(TEXT, { writeText })).resolves.toBe("fallback");
  });
});

describe("the Copy button", () => {
  const markup = renderToStaticMarkup(<CopyButton text={TEXT} />);

  it("is a button that does not submit the page it sits on", () => {
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>/);
    expect(markup).toContain("Copy");
  });

  it("is a thumb-sized target like every other control", () => {
    expect(/<button[^>]*>/.exec(markup)?.[0]).toContain("min-h-tap");
  });

  it("shows no text box until it is clicked", () => {
    // SPEC.md §3.8: it fires only on explicit click. The fallback is the
    // answer to a click, not something drawn on every page load.
    expect(markup).not.toContain("<textarea");
  });

  it("keeps the household's list out of the markup until it is asked for", () => {
    expect(markup).not.toContain("Chickpeas");
  });

  it("has somewhere to announce that the copy worked", () => {
    expect(markup).toMatch(/role="status"/);
  });
});

describe("the non-secure-context fallback", () => {
  const markup = renderToStaticMarkup(<ClipboardFallback text={TEXT} />);
  const textarea = /<textarea[^>]*>/.exec(markup)?.[0] ?? "";

  it("puts the whole text in a read-only text box", () => {
    // HTML attribute names are case-insensitive; React writes this one `readOnly`.
    expect(textarea).toMatch(/\sreadonly=""/i);
    // The same string the clipboard would have been handed, newlines and all.
    expect(markup).toContain(`>${TEXT}</textarea>`);
  });

  it("tells the user what to do with it", () => {
    const id = /\sid="([^"]*)"/.exec(textarea)?.[1];

    expect(id).toBeDefined();
    expect(markup).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>Select all and copy</label>`));
  });

  it("is tall enough to show every line without scrolling", () => {
    expect(textarea).toContain(`rows="${TEXT.split("\n").length}"`);
  });
});
