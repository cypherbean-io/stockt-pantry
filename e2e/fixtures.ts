import { expect, test as base } from "@playwright/test";

import { E2E_BASE_URL } from "./server";

/**
 * The base `test` every spec in this directory imports (SPEC.md §4, §5 item 8).
 *
 * It carries one automatic fixture: **nothing may leave the app's own origin.**
 * A self-hosted household app makes no outbound browser request at all — system
 * fonts, inline SVG icons, no CDN, no analytics, no external stylesheet — and
 * that is a property worth failing a build over rather than re-auditing by eye.
 * A `next/font/google` import or a single `<img src="https://…">` added later
 * is invisible in review and immediately visible here.
 *
 * It is also the more honest version of a privacy claim: the check is on what
 * the browser actually fetched while rendering, not on what the source appears
 * to reference.
 *
 * Only `http(s)` is inspected. `data:`, `blob:` and `about:blank` never touch
 * the network, and flagging them would make the guard noisy enough to be turned
 * off — which is the usual way a check like this dies.
 */
export const test = base.extend<{ sameOriginOnly: void }>({
  sameOriginOnly: [
    async ({ page }, use) => {
      const origin = new URL(E2E_BASE_URL).origin;
      const offOrigin = new Set<string>();

      page.on("request", (request) => {
        const url = request.url();
        if (!/^https?:/i.test(url)) return;
        if (new URL(url).origin !== origin) offOrigin.add(url);
      });

      await use();

      expect(
        [...offOrigin],
        "SPEC.md §4: the app must make no third-party browser request, and these left its origin",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
