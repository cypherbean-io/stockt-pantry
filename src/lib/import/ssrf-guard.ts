import { lookup as dnsLookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/**
 * Pre-flight check for the recipe-import fetcher (SPEC.md §4).
 *
 * A user-supplied URL fetched server-side is the one genuinely new attack
 * surface in v1. Before any connection is opened we insist on an http(s)
 * scheme, resolve the host, and reject the request if *any* answer lands in a
 * range that isn't publicly routable — internal services, cloud metadata
 * (169.254.169.254), and the app's own network all live in those ranges.
 *
 * Everything here fails closed: an address we cannot parse is not public.
 */

export type LookupFn = (hostname: string) => Promise<readonly string[]>;

export type GuardRejection =
  | { readonly reason: "invalid-url" }
  | { readonly reason: "blocked-scheme"; readonly scheme: string }
  | { readonly reason: "blocked-port"; readonly port: string }
  | { readonly reason: "blocked-credentials" }
  | { readonly reason: "dns-failure"; readonly hostname: string }
  | { readonly reason: "blocked-address"; readonly hostname: string; readonly address: string };

export type GuardResult =
  | { readonly ok: true; readonly url: URL; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly rejection: GuardRejection };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Web ports only. Private ranges are blocked regardless, but leaving the port
 * open lets a caller distinguish "refused" from "timed out" on arbitrary public
 * hosts — a port scanner wearing the app's source address.
 */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * IPv4 ranges that must never be reached. Beyond the RFC1918 trio this covers
 * loopback, the link-local block holding the cloud metadata endpoint, CGNAT,
 * the documentation/benchmark blocks, multicast and the reserved 240/4 tail
 * (which is where 255.255.255.255 lives).
 */
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inV4Range(address: number, [base, bits]: readonly [string, number]): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  return address >>> (32 - bits) === baseInt >>> (32 - bits);
}

/** Expands `::` and any trailing dotted-quad into eight 16-bit groups. */
function parseIpv6(input: string): readonly number[] | null {
  const address = input.split("%")[0] ?? ""; // drop any zone id
  let text = address;

  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const embedded = ipv4ToInt(tail);
    if (embedded === null) return null;
    const high = (embedded >>> 16).toString(16);
    const low = (embedded & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  let groups: string[];
  const compression = text.indexOf("::");
  if (compression === -1) {
    groups = text.split(":");
  } else {
    if (text.indexOf("::", compression + 1) !== -1) return null;
    const left = text.slice(0, compression);
    const right = text.slice(compression + 2);
    const head = left === "" ? [] : left.split(":");
    const foot = right === "" ? [] : right.split(":");
    const fill = 8 - head.length - foot.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...foot];
  }

  if (groups.length !== 8) return null;

  const parsed: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    parsed.push(Number.parseInt(group, 16));
  }
  return parsed;
}

function toDotted(high: number, low: number): string {
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".");
}

/**
 * True only for addresses we are willing to open a connection to. Anything
 * unparseable, private, loopback, link-local, multicast or reserved is false.
 */
export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) {
    const value = ipv4ToInt(address);
    if (value === null) return false;
    return !BLOCKED_V4.some((range) => inV4Range(value, range));
  }

  if (isIPv6(address)) {
    const groups = parseIpv6(address);
    if (groups === null) return false;

    const first = groups[0] ?? 0;
    const second = groups[1] ?? 0;

    // Allowlist, not blocklist: 2000::/3 is the only global unicast space, so
    // loopback, ULA, link-local, multicast, NAT64, IPv4-mapped/translated and
    // every unallocated block fail closed without needing a rule apiece.
    if ((first & 0xe000) !== 0x2000) return false;

    // 6to4 tunnels an IPv4 address inside a 2000::/3 address — judge it by
    // where it actually points.
    if (first === 0x2002) return isPublicAddress(toDotted(second, groups[2] ?? 0));

    if (first === 0x3fff && (second & 0xf000) === 0) return false; // 3fff::/20 documentation

    if (first === 0x2001) {
      if (second === 0x0000) return false; // 2001::/32 Teredo
      if (second === 0x0db8) return false; // 2001:db8::/32 documentation
      if (second === 0x0002 && (groups[2] ?? 0) === 0) return false; // 2001:2::/48 benchmarking
      if ((second & 0xfff0) === 0x0010) return false; // 2001:10::/28 ORCHID
      if ((second & 0xfff0) === 0x0020) return false; // 2001:20::/28 ORCHIDv2
    }

    return true;
  }

  return false;
}

async function defaultLookup(hostname: string): Promise<readonly string[]> {
  // Keep these options as they are. They return A records as plain dotted
  // quads, which is what lets `isPublicAddress` reject every ::ffff:* form
  // outright. Adding `family: 6` or a V4MAPPED hint would hand it IPv4-mapped
  // addresses instead, and every IPv4-only host would start being rejected.
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

/**
 * Validate a user-supplied URL before it is fetched.
 *
 * The returned `addresses` are what the host resolved to at check time. Note
 * the residual DNS-rebinding window: the client re-resolves when it connects,
 * so this narrows the attack rather than closing it — see the note in
 * `fetch-page.ts`.
 */
export async function guardUrl(
  rawUrl: string,
  lookup: LookupFn = defaultLookup,
): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, rejection: { reason: "invalid-url" } };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, rejection: { reason: "blocked-scheme", scheme: url.protocol } };
  }

  // `url.port` is "" when the port is the scheme's default.
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, rejection: { reason: "blocked-port", port: url.port } };
  }

  // Credentials in the URL would be sent upstream as an Authorization header.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, rejection: { reason: "blocked-credentials" } };
  }

  // WHATWG URL keeps the brackets on an IPv6 literal; DNS wants them gone.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  let addresses: readonly string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { ok: false, rejection: { reason: "dns-failure", hostname } };
  }

  if (addresses.length === 0) {
    return { ok: false, rejection: { reason: "dns-failure", hostname } };
  }

  // Every answer must be public: the client is free to pick any of them.
  const blocked = addresses.find((address) => !isPublicAddress(address));
  if (blocked !== undefined) {
    return { ok: false, rejection: { reason: "blocked-address", hostname, address: blocked } };
  }

  return { ok: true, url, addresses };
}
