// Unit tests for db/db.js's translateDatabaseError: the mapping from a
// Postgres error code to the answer a client gets. This is what stands
// between a constraint name and an unexplained 500, so the mapping for each
// code it understands is pinned down here, without needing a real database
// error to provoke it.

import test from "node:test";
import assert from "node:assert/strict";
import { translateDatabaseError } from "../../src/db/db.js";
import { ApiError } from "../../src/http/errors.js";

test("a foreign key violation becomes a 409 naming the constraint", () => {
  const error = translateDatabaseError({ code: "23503", constraint: "fk_person" });
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 409);
  assert.equal(error.code, "conflict");
  assert.equal(error.details.constraint, "fk_person");
});

test("a unique violation becomes a 409 saying a record like it already exists", () => {
  const error = translateDatabaseError({ code: "23505", constraint: "users_email_key" });
  assert.equal(error.status, 409);
  assert.match(error.message, /already exists/);
  assert.equal(error.details.constraint, "users_email_key");
});

test("a check violation becomes a 422 rule violation", () => {
  const error = translateDatabaseError({ code: "23514", constraint: "positive_employee_count" });
  assert.equal(error.status, 422);
  assert.equal(error.code, "rule_violation");
});

test("a not-null violation becomes a 422 naming the missing column", () => {
  const error = translateDatabaseError({ code: "23502", column: "name" });
  assert.equal(error.status, 422);
  assert.match(error.message, /name must be given/);
});

test("a not-null violation with no column name still produces a sensible message", () => {
  const error = translateDatabaseError({ code: "23502" });
  assert.match(error.message, /A required field must be given/);
});

test("an unrecognised or absent error code is left untranslated, so it falls through as a 500", () => {
  assert.equal(translateDatabaseError({ code: "40001" }), null);
  assert.equal(translateDatabaseError({}), null);
  assert.equal(translateDatabaseError(null), null);
  assert.equal(translateDatabaseError(undefined), null);
});
