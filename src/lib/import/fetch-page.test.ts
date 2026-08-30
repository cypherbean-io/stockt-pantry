import { describe, expect, it, vi } from "vitest";

import {
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  describeFailure,
  fetchPage,
  redactUrlForLog,
} from "./fetch-page";

const PUBLIC_IP = "93.184.216.34";

function resolvesTo(...addresses: readonly string[]) {
  return vi.fn(async () => addresses);
}

/** Resolves every host to a public address except the ones named private. */
function resolverWithPrivate(...privateHosts: readonly string[]) {
  return vi.fn(async (hostname: string) =>
    privateHosts.includes(hostname) ? ["169.254.169.254"] : [PUBLIC_IP],
  );
}

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

function streamingResponse(chunks: readonly string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  // A streamed body carries no content-length, so only the read-side cap can stop it.
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

/** Serves canned responses by URL; records every call so we can assert on reach. */
function serve(routes: Record<string, Response | (() => Response)>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch: ${url}`);
    return typeof route === "function" ? route() : route;
  });
}

describe("fetchPage", () => {
  it("returns the page body for a public https URL", async () => {
    const fetchImpl = serve({
      "https://example.com/cookies": htmlResponse("<html>cookies</html>"),
    });

    const result = await fetchPage("https://example.com/cookies", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.page.html).toBe("<html>cookies</html>");
    expect(result.ok === true && result.page.finalUrl).toBe("https://example.com/cookies");
  });

  it("never opens a connection to a URL that resolves to a private address", async () => {
    const fetchImpl = serve({});

    const result = await fetchPage("http://169.254.169.254/latest/meta-data/", {
      lookup: resolvesTo("169.254.169.254"),
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("blocked-url");
  });

  it("sends no cookies or credentials, and never lets the client follow redirects itself", async () => {
    const fetchImpl = serve({
      "https://example.com/r": htmlResponse("<html></html>"),
    });

    await fetchPage("https://example.com/r", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    // Next.js patches global fetch with a persistent cache; a user-supplied URL
    // must never be served from it or memoized into it.
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const headerNames = Object.keys(init.headers as Record<string, string>).map((name) =>
      name.toLowerCase(),
    );
    expect(headerNames).not.toContain("cookie");
    expect(headerNames).not.toContain("authorization");
  });

  it("revalidates each redirect hop and follows one that stays public", async () => {
    const fetchImpl = serve({
      "https://example.com/old": redirectTo("https://example.com/new", 301),
      "https://example.com/new": htmlResponse("<html>moved</html>"),
    });

    const result = await fetchPage("https://example.com/old", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.page.html).toBe("<html>moved</html>");
    expect(result.ok === true && result.page.finalUrl).toBe("https://example.com/new");
  });

  it("rejects a redirect that points at a private address, without requesting it", async () => {
    const fetchImpl = serve({
      "https://example.com/bounce": redirectTo("http://metadata.internal/latest/"),
    });

    const result = await fetchPage("https://example.com/bounce", {
      lookup: resolverWithPrivate("metadata.internal"),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("blocked-url");
  });

  it("revalidates a relative redirect against the resolved absolute target", async () => {
    const fetchImpl = serve({
      "https://example.com/a": redirectTo("/b"),
      "https://example.com/b": htmlResponse("<html>b</html>"),
    });

    const result = await fetchPage("https://example.com/a", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.page.finalUrl).toBe("https://example.com/b");
  });

  it("rejects a redirect that hops to a non-http scheme", async () => {
    const fetchImpl = serve({
      "https://example.com/a": redirectTo("file:///etc/passwd"),
    });

    const result = await fetchPage("https://example.com/a", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("blocked-url");
  });

  it("gives up on a redirect loop rather than following it forever", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      redirectTo(`${String(input)}x`),
    );

    const result = await fetchPage("https://example.com/loop", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("too-many-redirects");
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it("rejects a response whose declared content-length exceeds the cap", async () => {
    const fetchImpl = serve({
      "https://example.com/big": htmlResponse("<html></html>", {
        headers: {
          "content-type": "text/html",
          "content-length": String(MAX_RESPONSE_BYTES + 1),
        },
      }),
    });

    const result = await fetchPage("https://example.com/big", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("too-large");
  });

  it("aborts a streamed body that grows past the cap without declaring its length", async () => {
    const half = "a".repeat(MAX_RESPONSE_BYTES / 2);
    const fetchImpl = serve({
      "https://example.com/stream": streamingResponse([half, half, half]),
    });

    const result = await fetchPage("https://example.com/stream", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("too-large");
  });

  it("surfaces a non-OK HTTP status as an explicit failure", async () => {
    const fetchImpl = serve({
      "https://example.com/403": htmlResponse("nope", { status: 403 }),
    });

    const result = await fetchPage("https://example.com/403", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("http-error");
    expect(result.ok === false && result.failure.reason === "http-error" && result.failure.status).toBe(403);
  });

  it("reports a timeout when the request outlives its deadline", async () => {
    const controller = new AbortController();
    // Mirrors real fetch: rejects on the abort event, or straight away if the
    // signal is already aborted by the time it is called.
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const fail = () =>
            reject(new DOMException("The operation was aborted.", "AbortError"));
          if (init?.signal?.aborted === true) fail();
          else init?.signal?.addEventListener("abort", fail);
        }),
    );

    const pending = fetchPage("https://example.com/slow", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
      signal: controller.signal,
    });
    controller.abort();

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("timeout");
  });

  it("gives up on a name resolution that outlives the deadline", async () => {
    // DNS has no signal of its own, so a hostile resolver that simply never
    // answers would otherwise hold the request open past the cap.
    const controller = new AbortController();
    const fetchImpl = serve({});
    const lookup = vi.fn(() => new Promise<readonly string[]>(() => {}));

    const pending = fetchPage("https://slow-dns.example.com/", {
      lookup,
      fetchImpl,
      signal: controller.signal,
    });
    controller.abort();

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("timeout");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a transport error rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection refused");
    });

    const result = await fetchPage("https://example.com/down", {
      lookup: resolvesTo(PUBLIC_IP),
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("network-error");
  });

  it("holds the spec's documented timeout and size caps", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(5_000);
    expect(MAX_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("describeFailure", () => {
  it("never tells the user which address an internal hostname resolved to", async () => {
    // Otherwise the import form is an internal DNS oracle: submit names, read
    // back the private IPs they resolve to (SPEC.md §4 logs this, not the UI).
    const result = await fetchPage("http://gitlab.corp.internal/", {
      lookup: resolvesTo("10.4.19.22"),
      fetchImpl: serve({}),
    });

    expect(result.ok).toBe(false);
    const message = result.ok === false ? describeFailure(result.failure) : "";

    expect(message).not.toContain("10.4.19.22");
    expect(message).not.toContain("corp.internal");
    expect(message.length).toBeGreaterThan(0);
  });

  it("keeps the resolved address on the failure itself, for the server-side log", async () => {
    // SPEC.md §4 wants "rejected-as-private-IP" logged; the detail stays
    // available to the caller, it just isn't what gets shown.
    const result = await fetchPage("http://gitlab.corp.internal/", {
      lookup: resolvesTo("10.4.19.22"),
      fetchImpl: serve({}),
    });

    expect(
      result.ok === false &&
        result.failure.reason === "blocked-url" &&
        result.failure.rejection.reason === "blocked-address" &&
        result.failure.rejection.address,
    ).toBe("10.4.19.22");
  });
});

describe("redactUrlForLog", () => {
  /**
   * SPEC.md §4 has the fetcher log its target URL and outcome, and in the same
   * breath says never to log a password. A pasted URL can carry both.
   */

  it("drops the userinfo a pasted URL carried", () => {
    // `guardUrl` rejects this URL *because* the userinfo is a credential — and
    // then the outcome gets logged, which is where it would land in plain text.
    expect(redactUrlForLog("https://alice:hunter2@example.com/recipe")).toBe(
      "https://example.com/recipe",
    );
  });

  it("drops a query string, which may itself be a signed token", () => {
    expect(redactUrlForLog("https://example.com/recipe?sig=abc123&t=9")).toBe(
      "https://example.com/recipe?…",
    );
  });

  it("keeps an ordinary URL intact, since that is what makes the log useful", () => {
    expect(redactUrlForLog("https://example.com/recipes/cookies")).toBe(
      "https://example.com/recipes/cookies",
    );
  });

  it("reduces a non-web scheme to the scheme, which is the whole of what is useful", () => {
    expect(redactUrlForLog("javascript:alert(document.cookie)")).toBe("<javascript: URL>");
  });

  it("says nothing about a URL it cannot parse rather than echoing it", () => {
    expect(redactUrlForLog("not a url")).toBe("<unparseable URL>");
  });

  it("escapes what it does emit, so a pasted URL cannot forge a log line", () => {
    const forged = redactUrlForLog("https://example.com/a\nRecipe import: success for b");

    expect(forged).not.toContain("\n");
  });
});
