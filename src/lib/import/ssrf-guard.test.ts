import { describe, expect, it, vi } from "vitest";

import { guardUrl, isPublicAddress } from "./ssrf-guard";

/** Stand-in for DNS at the process boundary — the only thing mocked here. */
function resolvesTo(...addresses: readonly string[]) {
  return vi.fn(async () => addresses);
}

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", "IPv4 loopback"],
    ["127.255.255.254", "the rest of 127.0.0.0/8"],
    ["10.0.0.1", "RFC1918 10.0.0.0/8"],
    ["172.16.0.1", "RFC1918 172.16.0.0/12"],
    ["172.31.255.255", "the top of the 172.16.0.0/12 block"],
    ["192.168.1.1", "RFC1918 192.168.0.0/16"],
    ["169.254.169.254", "the cloud metadata endpoint"],
    ["0.0.0.0", "the unspecified address"],
    ["100.64.0.1", "carrier-grade NAT space"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["::1", "IPv6 loopback"],
    ["::", "the IPv6 unspecified address"],
    ["fc00::1", "IPv6 unique local addresses"],
    ["fd12:3456::1", "the fd00::/8 half of unique local space"],
    ["fe80::1", "IPv6 link-local"],
    ["ff02::1", "IPv6 multicast"],
    ["::ffff:127.0.0.1", "an IPv4-mapped loopback address"],
    ["::ffff:169.254.169.254", "an IPv4-mapped metadata address"],
    ["::ffff:0:7f00:1", "an IPv4-translated loopback address"],
    ["fec0::1", "deprecated IPv6 site-local space"],
    ["64:ff9b:1::7f00:1", "the local-use NAT64 prefix"],
    ["2001::1", "a Teredo tunnel address"],
    ["2001:10::1", "ORCHID space"],
    ["2001:20::1", "ORCHIDv2 space"],
    ["2001:2::1", "IPv6 benchmarking space"],
    ["2001:db8::1", "IPv6 documentation space"],
    ["2002:7f00:1::1", "a 6to4 address wrapping 127.0.0.1"],
    ["2002:a9fe:a9fe::1", "a 6to4 address wrapping the metadata endpoint"],
    ["3fff::1", "the RFC 9637 documentation range"],
  ])("rejects %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ["93.184.216.34", "a routable IPv4 address"],
    ["8.8.8.8", "a public resolver"],
    ["172.32.0.1", "an address just above the RFC1918 172.16.0.0/12 block"],
    ["172.15.255.255", "an address just below it"],
    ["2606:2800:220:1:248:1893:25c8:1946", "a routable IPv6 address"],
    ["2002:5db8:d834::1", "a 6to4 address wrapping a routable IPv4 address"],
    ["3fff:1000::1", "an address just outside the 3fff::/20 documentation range"],
  ])("accepts %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("rejects an address outside global unicast space even if no rule names it", () => {
    // The v6 rule is an allowlist: only 2000::/3 is global unicast, so unnamed
    // special-purpose blocks fail closed instead of slipping through.
    expect(isPublicAddress("0800::1")).toBe(false); // unallocated, below 2000::/3
    expect(isPublicAddress("2400::1")).toBe(true); // allocated global unicast
    expect(isPublicAddress("4000::1")).toBe(false); // unallocated, above 2000::/3
  });

  it("rejects anything that is not a parseable IP rather than assuming it is public", () => {
    expect(isPublicAddress("not-an-ip")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("guardUrl", () => {
  it("accepts an https URL whose host resolves to a public address", async () => {
    const lookup = resolvesTo("93.184.216.34");
    const result = await guardUrl("https://example.com/recipes/cookies", lookup);

    expect(result.ok).toBe(true);
    expect(lookup).toHaveBeenCalledWith("example.com");
  });

  it("rejects a scheme other than http or https", async () => {
    const lookup = resolvesTo("93.184.216.34");

    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com/x",
      "data:text/html,<h1>hi</h1>",
    ]) {
      const result = await guardUrl(url, lookup);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.rejection.reason).toBe("blocked-scheme");
    }
    // Scheme is rejected on inspection, so DNS is never consulted.
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a string that is not a URL at all", async () => {
    const result = await guardUrl("definitely not a url", resolvesTo("93.184.216.34"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("invalid-url");
  });

  it("rejects a host that resolves to the cloud metadata endpoint", async () => {
    const result = await guardUrl("http://169.254.169.254/latest/meta-data/", resolvesTo("169.254.169.254"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("blocked-address");
  });

  it("rejects a public-looking hostname that resolves to a private address", async () => {
    // DNS rebinding's simplest form: the name is innocuous, the answer is not.
    const result = await guardUrl("https://internal.example.com/", resolvesTo("10.1.2.3"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("blocked-address");
  });

  it("rejects when only one of several resolved addresses is private", async () => {
    // A partial block is still a block: the client could pick any of these.
    const result = await guardUrl(
      "https://split.example.com/",
      resolvesTo("93.184.216.34", "127.0.0.1"),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("blocked-address");
  });

  it("strips brackets from an IPv6 literal host before resolving it", async () => {
    const lookup = resolvesTo("::1");
    const result = await guardUrl("http://[::1]/", lookup);

    expect(lookup).toHaveBeenCalledWith("::1");
    expect(result.ok).toBe(false);
  });

  it("reports a DNS failure instead of falling through to a fetch", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    const result = await guardUrl("https://nx.example.com/", lookup);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("dns-failure");
  });

  it("rejects a host that resolves to nothing", async () => {
    const result = await guardUrl("https://empty.example.com/", resolvesTo());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("dns-failure");
  });

  it("rejects a non-web port, which would make the importer a port scanner", async () => {
    // Private ranges are already blocked, but distinguishable failures against
    // an arbitrary public host:port turn this into a scanning oracle.
    const result = await guardUrl("http://example.com:25/", resolvesTo("93.184.216.34"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("blocked-port");
  });

  it("accepts the web ports, stated or implied", async () => {
    for (const url of [
      "http://example.com/",
      "https://example.com/",
      "http://example.com:80/",
      "https://example.com:443/",
    ]) {
      const result = await guardUrl(url, resolvesTo("93.184.216.34"));
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a URL carrying embedded credentials", async () => {
    // Credentials in the URL would be attached to the outbound request (SPEC.md §4).
    const result = await guardUrl("https://user:pass@example.com/", resolvesTo("93.184.216.34"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.reason).toBe("blocked-credentials");
  });
});
