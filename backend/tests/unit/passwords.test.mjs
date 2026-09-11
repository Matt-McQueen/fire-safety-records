// Unit tests for auth/passwords.js: hashing, verification and the password
// policy. No database and no server — the only I/O here is scrypt itself.
//
// The cost is lowered before config/env.js is imported (hashPassword reads it
// from there), the same way tests/helpers.mjs does for the integration suite,
// so a run of this file does not spend its time hashing at the production
// cost. It has to happen before that import runs, and in an ES module every
// static `import` executes before the importing file's own top-level code —
// regardless of where the import line sits in the file — so the assignment
// is done first and the module under test is loaded dynamically afterwards.
process.env.SCRYPT_COST = process.env.SCRYPT_COST ?? "1024";

import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../../src/http/errors.js";
const { assertPasswordAcceptable, hashPassword, needsRehash, verifyPassword } = await import(
  "../../src/auth/passwords.js"
);

test("a password verifies against its own hash, and against no other password", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.equal(await verifyPassword("correct-horse-battery-staple", hash), true);
  assert.equal(await verifyPassword("wrong-horse-battery-staple", hash), false);
});

test("two hashes of the same password differ, because the salt differs", async () => {
  const first = await hashPassword("same-password-both-times");
  const second = await hashPassword("same-password-both-times");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("same-password-both-times", first), true);
  assert.equal(await verifyPassword("same-password-both-times", second), true);
});

test("the stored hash records its format as scrypt$cost$blockSize$parallelism$salt$hash", async () => {
  const hash = await hashPassword("whatever-passphrase-here");
  const parts = hash.split("$");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
  assert.equal(Number(parts[1]), 1024);
});

test("verifyPassword returns false rather than throwing on a malformed or foreign stored value", async () => {
  assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("anything", ""), false);
  assert.equal(await verifyPassword("anything", null), false);
  assert.equal(await verifyPassword("anything", "bcrypt$10$somesalt$somehash"), false);
});

test("needsRehash is true for a hash made at a lower cost than the current setting, and false at the current one", async () => {
  const current = await hashPassword("passphrase-at-current-cost");
  assert.equal(needsRehash(current), false);

  const stale = ["scrypt", 512, 8, 1, "c2FsdA==", "aGFzaA=="].join("$");
  assert.equal(needsRehash(stale), true);

  assert.equal(needsRehash("garbage"), true);
});

test("assertPasswordAcceptable refuses a password shorter than 12 characters", () => {
  assert.throws(() => assertPasswordAcceptable("short7chars"), /at least 12 characters/);
});

test("assertPasswordAcceptable refuses a password longer than 200 characters", () => {
  assert.throws(() => assertPasswordAcceptable("x".repeat(201)), /at most 200 characters/);
});

test("assertPasswordAcceptable refuses the handful of easily guessed passwords, case-insensitively", () => {
  // Long enough to clear the length check on their own, so it is specifically
  // the "too easily guessed" rule being exercised here.
  assert.throws(() => assertPasswordAcceptable("Administrator"), /too easily guessed/);
  assert.throws(() => assertPasswordAcceptable("12345678901234"), /too easily guessed/);
});

test("assertPasswordAcceptable refuses a single repeated character regardless of length", () => {
  assert.throws(() => assertPasswordAcceptable("aaaaaaaaaaaaaaaaaaaa"), /single repeated character/);
});

test("assertPasswordAcceptable refuses a password containing the account's email address", () => {
  assert.throws(
    () => assertPasswordAcceptable("my-jsmith-passphrase", { email: "jsmith@example.com" }),
    /must not contain your email/,
  );
  // A short local part (under 4 characters) is not checked, to avoid false
  // positives on common short words.
  assert.doesNotThrow(() =>
    assertPasswordAcceptable("a-perfectly-fine-passphrase", { email: "jo@example.com" }),
  );
});

test("assertPasswordAcceptable refuses a password containing a word from the account's name", () => {
  assert.throws(
    () => assertPasswordAcceptable("include-cordelia-here-99", { fullName: "Cordelia Vance" }),
    /must not contain your name/,
  );
});

test("assertPasswordAcceptable accepts a long passphrase unrelated to the account", () => {
  assert.doesNotThrow(() =>
    assertPasswordAcceptable("correct-horse-battery-staple-42", {
      email: "user@example.com",
      fullName: "Jordan Reid",
    }),
  );
});

test("assertPasswordAcceptable's failures are 400 ApiErrors, not generic errors", () => {
  try {
    assertPasswordAcceptable("short");
    assert.fail("expected assertPasswordAcceptable to throw");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
  }
});
