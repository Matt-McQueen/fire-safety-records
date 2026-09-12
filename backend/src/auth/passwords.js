// Password hashing with scrypt from node:crypto.
//
// scrypt is memory-hard and is in the standard library, so there is no native
// module to build and nothing to keep patched. Hashes are stored in a
// self-describing format, so the cost can be raised later without invalidating
// existing passwords: an old hash still verifies against the parameters
// recorded in it, and `needsRehash` reports when it should be upgraded on the
// next successful login.

import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config/env.js";
import { badRequest } from "../http/errors.js";

const scrypt = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

// scrypt needs roughly 128 * N * r bytes, which is 64 MB at the default cost.
// Node's own default is 32 MB, so the ceiling is raised here with headroom for
// a future increase in cost.
const MAX_MEMORY = 256 * 1024 * 1024;

export async function hashPassword(password) {
  const cost = config.auth.scryptCost;
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: cost,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });
  return [
    "scrypt",
    cost,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed) return false;

  const derived = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.hash.length, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelism,
    maxmem: MAX_MEMORY,
  });

  // Constant-time: a length check first, because timingSafeEqual throws on a
  // length mismatch and throwing would itself leak the length.
  if (derived.length !== parsed.hash.length) return false;
  return crypto.timingSafeEqual(derived, parsed.hash);
}

export function needsRehash(stored) {
  const parsed = parse(stored);
  return !parsed || parsed.cost < config.auth.scryptCost;
}

// A compact self-describing format's own parser; already minimal for what it
// validates.
// fallow-ignore-next-line complexity
function parse(stored) {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, cost, blockSize, parallelism, salt, hash] = parts;
  const parsed = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelism: Number(parallelism),
    salt: Buffer.from(salt, "base64"),
    hash: Buffer.from(hash, "base64"),
  };
  if (!Number.isInteger(parsed.cost) || parsed.cost < 2) return null;
  if (!Number.isInteger(parsed.blockSize) || !Number.isInteger(parsed.parallelism)) return null;
  return parsed;
}

// Deliberately not a strength meter. Length carries far more entropy than
// character-class rules do, so the only requirement is a long passphrase,
// checked against the handful of values people actually pick.
const OBVIOUS = new Set([
  "password", "password1", "passw0rd", "letmein", "welcome", "qwertyuiop",
  "administrator", "changeme", "iloveyou", "1234567890", "12345678901234",
]);

export function assertPasswordAcceptable(password, { email, fullName } = {}) {
  const value = String(password ?? "");
  assertLengthAcceptable(value);
  const folded = value.toLowerCase();
  assertNotObvious(value, folded);
  assertNotDerivedFromIdentity(folded, email, fullName);
}

function assertLengthAcceptable(value) {
  if (value.length < 12) {
    throw badRequest("Password must be at least 12 characters");
  }
  if (value.length > 200) {
    // Long inputs cost real CPU to hash, so the ceiling is a denial-of-service
    // control rather than a password policy.
    throw badRequest("Password must be at most 200 characters");
  }
}

function assertNotObvious(value, folded) {
  if (OBVIOUS.has(folded)) {
    throw badRequest("Password is too easily guessed");
  }
  if (/^(.)\1+$/.test(value)) {
    throw badRequest("Password must not be a single repeated character");
  }
}

function assertNotDerivedFromIdentity(folded, email, fullName) {
  const localPart = String(email ?? "").split("@")[0].toLowerCase();
  if (localPart.length >= 4 && folded.includes(localPart)) {
    throw badRequest("Password must not contain your email address");
  }
  for (const word of String(fullName ?? "").toLowerCase().split(/\s+/)) {
    if (word.length >= 4 && folded.includes(word)) {
      throw badRequest("Password must not contain your name");
    }
  }
}
