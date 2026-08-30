import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing (SPEC.md §4: "argon2id or equivalent — no custom hashing").
 *
 * The equivalent here is scrypt out of `node:crypto` at OWASP's recommended
 * parameters. It is a standard memory-hard KDF, not a construction invented for
 * this repo; what this module adds is the storage envelope around it — a random
 * per-password salt, the parameters recorded next to the digest, and a
 * constant-time comparison.
 *
 * Why not a library: SPEC.md names Lucia or Auth.js, but Lucia is deprecated
 * (its own docs now point you at implementing sessions directly) and Auth.js's
 * credentials provider only supports JWT sessions, which contradicts the
 * server-side sessions SPEC.md §3 asks for. Neither would have hashed the
 * password for us anyway.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export type ScryptParams = {
  readonly N: number;
  readonly r: number;
  readonly p: number;
};

/** OWASP Password Storage Cheat Sheet's scrypt minimum: N=2^17, r=8, p=1. */
export const SCRYPT_PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCHEME = "scrypt";

/**
 * A stored hash is data, and data can be wrong. Without an upper bound, a row
 * claiming N=2^40 would turn one login attempt into an out-of-memory kill.
 *
 * scrypt's working set is `128 * N * r`, so the bound that matters is on the
 * *product* — N and r each within range still multiplies out to 4 GiB at
 * N=2^20, r=32. The per-factor limits below only keep the arithmetic sane; the
 * working-set check is what caps the allocation.
 */
const MAX_WORKING_SET_BYTES = 1024 * 1024 * 1024;
const MAX_N = 2 ** 20;
const MAX_R = 32;
/** Multiplies CPU cost rather than memory, so it gets its own small ceiling. */
const MAX_P = 16;

/** Node refuses to run scrypt unless `maxmem` exceeds the working set. */
function maxmemFor({ N, r }: ScryptParams): number {
  return 2 * 128 * N * r;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 1 && (value & (value - 1)) === 0;
}

/**
 * `scrypt$N$r$p$salt$digest`, salt and digest in base64url.
 *
 * Self-describing so the cost can be raised later without invalidating every
 * existing password: `verifyPassword` reads the parameters out of the stored
 * string rather than assuming today's.
 */
export async function hashPassword(
  password: string,
  params: ScryptParams = SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const digest = await scryptAsync(password, salt, KEY_BYTES, {
    ...params,
    maxmem: maxmemFor(params),
  });

  return [
    SCHEME,
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

type StoredHash = {
  readonly params: ScryptParams;
  readonly salt: Buffer;
  readonly digest: Buffer;
};

function parseStored(stored: string): StoredHash | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6) return undefined;

  const [scheme, rawN, rawR, rawP, rawSalt, rawDigest] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (scheme !== SCHEME) return undefined;

  const params = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  if (!isPowerOfTwo(params.N) || params.N > MAX_N) return undefined;
  if (!Number.isInteger(params.r) || params.r < 1 || params.r > MAX_R) return undefined;
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > MAX_P) return undefined;
  if (128 * params.N * params.r > MAX_WORKING_SET_BYTES) return undefined;

  if (rawSalt === "") return undefined;
  const salt = Buffer.from(rawSalt, "base64url");
  if (salt.length === 0) return undefined;

  const digest = Buffer.from(rawDigest, "base64url");
  // Fixed width, so a truncated or padded digest is rejected here rather than
  // reaching a comparison that would throw on the length mismatch.
  if (digest.length !== KEY_BYTES) return undefined;

  return { params, salt, digest };
}

/**
 * Returns whether `password` produced `stored`.
 *
 * Every rejection path returns false rather than throwing. A malformed row is
 * an operational problem, but from the caller's side the answer to "should this
 * login succeed" is still no, and an exception here would surface as a 500 that
 * distinguishes a corrupt account from a wrong password.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (parsed === undefined) return false;

  const candidate = await scryptAsync(password, parsed.salt, KEY_BYTES, {
    ...parsed.params,
    maxmem: maxmemFor(parsed.params),
  });

  return timingSafeEqual(candidate, parsed.digest);
}
