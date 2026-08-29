import type { GuardRejection, LookupFn } from "./ssrf-guard";
import { guardUrl } from "./ssrf-guard";

/**
 * The recipe-import page fetcher (SPEC.md §3 step 2, §4).
 *
 * Every mitigation the spec calls for lives here: scheme + address guard on the
 * initial URL *and* on every redirect hop, a deadline covering the whole chain,
 * a byte cap on the response, and an outbound request that carries no
 * credentials, cookies, or internal headers.
 *
 * Known residual risk: the guard resolves DNS, then the HTTP client resolves it
 * again when it connects, so a hostile resolver can still rebind between the two
 * (TOCTOU). Closing that needs the connection pinned to the validated IP, which
 * means a custom undici dispatcher — a dependency decision, not a code one.
 */

export const REQUEST_TIMEOUT_MS = 5_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Nothing identifying, nothing authenticating (SPEC.md §4). */
const OUTBOUND_HEADERS: Readonly<Record<string, string>> = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en",
  "user-agent": "stockt-pantry/0.1 (recipe import)",
};

export type FetchFailure =
  | { readonly reason: "blocked-url"; readonly url: string; readonly rejection: GuardRejection }
  | { readonly reason: "too-many-redirects"; readonly url: string }
  | { readonly reason: "http-error"; readonly status: number }
  | { readonly reason: "too-large"; readonly limitBytes: number }
  | { readonly reason: "timeout"; readonly timeoutMs: number }
  | { readonly reason: "network-error"; readonly detail: string };

export type FetchedPage = {
  /** The URL the body actually came from, after any redirects. */
  readonly finalUrl: string;
  readonly html: string;
};

export type FetchPageResult =
  | { readonly ok: true; readonly page: FetchedPage }
  | { readonly ok: false; readonly failure: FetchFailure };

export type FetchPageDeps = {
  readonly lookup?: LookupFn;
  readonly fetchImpl?: typeof fetch;
  /** Overrides the default deadline; the whole redirect chain shares one. */
  readonly signal?: AbortSignal;
};

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rejects when the deadline fires. `dns.lookup` takes no AbortSignal, so the
 * only way to bound a resolver that never answers is to race it.
 */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

/** Honours the response charset when we can, falling back to UTF-8. */
function decode(bytes: Uint8Array, contentType: string | null): string {
  const charset = contentType?.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1];
  if (charset !== undefined) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown label — fall through to UTF-8 rather than failing the import.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Read the body a chunk at a time, bailing the moment the running total passes
 * the cap so an endless response can't exhaust memory.
 */
async function readCapped(
  response: Response,
): Promise<{ readonly ok: true; readonly html: string } | { readonly ok: false; readonly failure: FetchFailure }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    return { ok: false, failure: { reason: "too-large", limitBytes: MAX_RESPONSE_BYTES } };
  }

  const body = response.body;
  if (body === null) return { ok: true, html: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return { ok: false, failure: { reason: "too-large", limitBytes: MAX_RESPONSE_BYTES } };
      }
      chunks.push(value);
    }
  } catch (error) {
    if (isAbort(error)) {
      return { ok: false, failure: { reason: "timeout", timeoutMs: REQUEST_TIMEOUT_MS } };
    }
    return { ok: false, failure: { reason: "network-error", detail: describe(error) } };
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, html: decode(joined, response.headers.get("content-type")) };
}

/**
 * Turn a failure into something safe to show the person who submitted the URL.
 *
 * The failure objects themselves carry the resolved address so the server can
 * log "rejected-as-private-IP" (SPEC.md §4). That detail must not travel back
 * to the browser: echoing it would turn the import form into an oracle for
 * mapping the internal network one hostname at a time.
 */
export function describeFailure(failure: FetchFailure): string {
  switch (failure.reason) {
    case "blocked-url":
      return "That URL can't be fetched. Recipe imports only accept public http or https pages.";
    case "too-many-redirects":
      return "That URL redirected too many times.";
    case "http-error":
      return `The site returned an error (HTTP ${failure.status}).`;
    case "too-large":
      return "That page is too large to import.";
    case "timeout":
      return "That site took too long to respond.";
    case "network-error":
      return "That page could not be reached.";
  }
}

/**
 * Fetch a user-supplied page. Never throws: every outcome, including a rejected
 * URL, comes back as a discriminated result. Show it via `describeFailure` —
 * the raw failure carries internal detail meant only for the server log.
 */
export async function fetchPage(
  rawUrl: string,
  deps: FetchPageDeps = {},
): Promise<FetchPageResult> {
  const { lookup, fetchImpl = fetch } = deps;
  // One deadline for the whole chain, so redirects can't extend it. Passing a
  // signal is also the documented opt-out from Next's fetch memoization.
  const signal = deps.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let guard: Awaited<ReturnType<typeof guardUrl>>;
    try {
      guard = await Promise.race([guardUrl(currentUrl, lookup), rejectOnAbort(signal)]);
    } catch (error) {
      if (isAbort(error)) {
        return { ok: false, failure: { reason: "timeout", timeoutMs: REQUEST_TIMEOUT_MS } };
      }
      return { ok: false, failure: { reason: "network-error", detail: describe(error) } };
    }

    if (!guard.ok) {
      return {
        ok: false,
        failure: { reason: "blocked-url", url: currentUrl, rejection: guard.rejection },
      };
    }

    let response: Response;
    try {
      response = await fetchImpl(guard.url.href, {
        method: "GET",
        // Redirects are followed by hand so each hop goes through the guard.
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: { ...OUTBOUND_HEADERS },
        signal,
      });
    } catch (error) {
      if (isAbort(error)) {
        return { ok: false, failure: { reason: "timeout", timeoutMs: REQUEST_TIMEOUT_MS } };
      }
      return { ok: false, failure: { reason: "network-error", detail: describe(error) } };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();

      if (location === null || location.trim() === "") {
        return {
          ok: false,
          failure: { reason: "network-error", detail: `redirect ${response.status} without a location` },
        };
      }

      let next: URL;
      try {
        next = new URL(location, guard.url);
      } catch {
        return {
          ok: false,
          failure: { reason: "blocked-url", url: location, rejection: { reason: "invalid-url" } },
        };
      }

      currentUrl = next.href;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, failure: { reason: "http-error", status: response.status } };
    }

    const body = await readCapped(response);
    if (!body.ok) return { ok: false, failure: body.failure };

    return { ok: true, page: { finalUrl: guard.url.href, html: body.html } };
  }

  return { ok: false, failure: { reason: "too-many-redirects", url: currentUrl } };
}
