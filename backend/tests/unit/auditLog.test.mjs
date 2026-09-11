// Unit tests for the pure parts of audit/auditLog.js: redacting sensitive
// keys before anything is written, and computing what a PATCH actually
// changed. `record` itself needs a database connection and stays covered by
// the integration suite's audit-trail tests.

import test from "node:test";
import assert from "node:assert/strict";
import { changedFields, redact } from "../../src/audit/auditLog.js";

test("redact masks keys that look like a credential, case-insensitively, and leaves the rest", () => {
  const result = redact({
    name: "J Smith",
    password: "hunter2",
    Password_Hash: "scrypt$...",
    refreshToken: "abc123",
    Authorization: "Bearer xyz",
    cookie: "fsr_refresh=...",
    apiSecret: "shh",
  });

  assert.equal(result.name, "J Smith");
  assert.equal(result.password, "[redacted]");
  assert.equal(result.Password_Hash, "[redacted]");
  assert.equal(result.refreshToken, "[redacted]");
  assert.equal(result.Authorization, "[redacted]");
  assert.equal(result.cookie, "[redacted]");
  assert.equal(result.apiSecret, "[redacted]");
});

test("redact recurses into nested objects and arrays", () => {
  const result = redact({
    user: { email: "a@example.com", password: "hunter2" },
    sessions: [{ token: "abc" }, { token: "def" }],
  });

  assert.equal(result.user.email, "a@example.com");
  assert.equal(result.user.password, "[redacted]");
  assert.equal(result.sessions[0].token, "[redacted]");
  assert.equal(result.sessions[1].token, "[redacted]");
});

test("redact leaves primitives and null untouched", () => {
  assert.equal(redact(null), null);
  assert.equal(redact("plain string"), "plain string");
  assert.equal(redact(42), 42);
});

test("changedFields reports only the keys present in the update, comparing against the prior row", () => {
  const before = { id: 1, scenario: "Original", notes: "Kept the same" };
  const after = { scenario: "Amended" };

  const changes = changedFields(before, after);
  assert.deepEqual(Object.keys(changes), ["scenario"]);
  assert.deepEqual(changes.scenario, { from: "Original", to: "Amended" });
});

test("changedFields reports nothing when the new value equals the old one", () => {
  const before = { scenario: "Same" };
  assert.deepEqual(changedFields(before, { scenario: "Same" }), {});
});

test("changedFields compares a Date from the database against an ISO string from the client as equal", () => {
  const before = { carried_out_on: new Date("2026-03-14T00:00:00.000Z") };
  const after = { carried_out_on: "2026-03-14T00:00:00.000Z" };
  assert.deepEqual(changedFields(before, after), {});
});

test("changedFields normalises null and undefined the same way", () => {
  const before = { notes: null };
  assert.deepEqual(changedFields(before, { notes: undefined }), {});
});

test("changedFields records a change from an absent field to a real value", () => {
  const before = {};
  const changes = changedFields(before, { notes: "New note" });
  assert.deepEqual(changes.notes, { from: null, to: "New note" });
});
