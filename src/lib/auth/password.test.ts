import { describe, expect, it } from "vitest";

import { SCRYPT_PARAMS, hashPassword, verifyPassword } from "./password";

/**
 * SPEC.md §4: passwords are hashed with "argon2id or equivalent — no custom
 * hashing". The equivalent here is scrypt from `node:crypto` at OWASP's
 * recommended parameters; what these tests pin down is that the construction
 * around it is the standard one — random per-password salt, parameters stored
 * alongside the digest, constant-time comparison, and no path where a malformed
 * stored value turns into an accepted login.
 */

describe("hashPassword", () => {
  it("produces a different digest each time for the same password", async () => {
    const [first, second] = await Promise.all([
      hashPassword("correct horse battery staple"),
      hashPassword("correct horse battery staple"),
    ]);

    expect(first).not.toEqual(second);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("hunter2-hunter2-hunter2");

    expect(stored).not.toContain("hunter2");
  });

  it("records the parameters it used, so they can be raised later", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const [scheme, n, r, p] = stored.split("$");

    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBe(SCRYPT_PARAMS.N);
    expect(Number(r)).toBe(SCRYPT_PARAMS.r);
    expect(Number(p)).toBe(SCRYPT_PARAMS.p);
  });

  it("uses at least OWASP's recommended scrypt cost", () => {
    // OWASP Password Storage Cheat Sheet: minimum N=2^17, r=8, p=1.
    expect(SCRYPT_PARAMS.N).toBeGreaterThanOrEqual(2 ** 17);
    expect(SCRYPT_PARAMS.r).toBeGreaterThanOrEqual(8);
    expect(SCRYPT_PARAMS.p).toBeGreaterThanOrEqual(1);
  });
});

describe("verifyPassword", () => {
  it("accepts the password that produced the digest", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a different password", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("correct horse battery stapler", stored)).toBe(false);
  });

  it("still accepts a digest written with weaker parameters than today's", async () => {
    // The point of encoding the parameters is that raising them does not lock
    // existing users out. A hash from a lower-cost era must still verify.
    const legacy = await hashPassword("correct horse battery staple", {
      N: 2 ** 14,
      r: 8,
      p: 1,
    });

    expect(legacy).toContain(`$${2 ** 14}$`);
    expect(await verifyPassword("correct horse battery staple", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["a bare digest with no parameters", "deadbeef"],
    ["an unknown scheme", "bcrypt$131072$8$1$c2FsdA$ZGlnZXN0"],
    ["a non-numeric cost", "scrypt$N$8$1$c2FsdA$ZGlnZXN0"],
    ["a missing digest field", "scrypt$131072$8$1$c2FsdA"],
    ["an empty salt", "scrypt$131072$8$1$$ZGlnZXN0"],
  ])("rejects %s rather than throwing", async (_label, stored) => {
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(false);
  });

  it("rejects a digest whose length has been tampered with", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const truncated = stored.slice(0, -4);

    // A naive comparison would throw on mismatched buffer lengths; the answer
    // to "is this the right password" is still no.
    await expect(verifyPassword("correct horse battery staple", truncated)).resolves.toBe(false);
  });

  it("refuses an absurd cost parameter instead of allocating for it", async () => {
    // The stored string is data. A row that says N=2^40 would otherwise turn a
    // login attempt into an out-of-memory kill.
    await expect(verifyPassword("whatever", `scrypt$${2 ** 40}$8$1$c2FsdA$ZGlnZXN0`)).resolves.toBe(
      false,
    );
  });

  it("bounds N and r together, not one at a time", async () => {
    // scrypt's working set is `128 * N * r`. Each of N=2^20 and r=32 is
    // individually within range, but together they ask for 4 GiB.
    await expect(
      verifyPassword("whatever", `scrypt$${2 ** 20}$32$1$c2FsdA$ZGlnZXN0`),
    ).resolves.toBe(false);
  });
});
