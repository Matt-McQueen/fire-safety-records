// Unit tests for the pure decision functions in auth/middleware.js: role
// ranking and the premises boundary. `authenticate` itself needs a database
// and a request, so it stays covered by tests/authorisation.test.mjs; what is
// tested here is the logic those routes are built on.

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPremisesAccess,
  atLeast,
  mayAccessPremises,
  rank,
  ROLES,
} from "../../src/auth/middleware.js";
import { ApiError } from "../../src/http/errors.js";

test("ROLES is ordered from least to most privileged", () => {
  assert.deepEqual(ROLES, ["viewer", "assessor", "manager", "admin"]);
});

test("rank reflects each role's position in ROLES, and an unrecognised role ranks below all of them", () => {
  assert.equal(rank("viewer"), 0);
  assert.equal(rank("assessor"), 1);
  assert.equal(rank("manager"), 2);
  assert.equal(rank("admin"), 3);
  assert.equal(rank("nonsense"), -1);
  assert.equal(rank(undefined), -1);
  assert.equal(rank(null), -1);
});

test("atLeast is true for the role itself and everything above it, false below", () => {
  assert.equal(atLeast("manager", "assessor"), true);
  assert.equal(atLeast("manager", "manager"), true);
  assert.equal(atLeast("manager", "admin"), false);
  assert.equal(atLeast("viewer", "assessor"), false);
  assert.equal(atLeast(undefined, "viewer"), false);
});

test("mayAccessPremises lets an admin (premisesIds: null) reach anything", () => {
  const admin = { premisesIds: null };
  assert.equal(mayAccessPremises(admin, 1), true);
  assert.equal(mayAccessPremises(admin, 999), true);
});

test("mayAccessPremises checks a non-admin's grants, coercing the id to a number", () => {
  const user = { premisesIds: [3, 7] };
  assert.equal(mayAccessPremises(user, 3), true);
  assert.equal(mayAccessPremises(user, "3"), true, "a string id should still match");
  assert.equal(mayAccessPremises(user, 4), false);
});

test("mayAccessPremises is false for an absent user", () => {
  assert.equal(mayAccessPremises(null, 1), false);
  assert.equal(mayAccessPremises(undefined, 1), false);
});

test("assertPremisesAccess passes silently when the premises is reachable", () => {
  assert.doesNotThrow(() => assertPremisesAccess({ premisesIds: [1] }, 1));
});

test("assertPremisesAccess refuses with 404 by default, so an unreachable premises is not confirmed to exist", () => {
  try {
    assertPremisesAccess({ premisesIds: [1] }, 2);
    assert.fail("expected assertPremisesAccess to throw");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
  }
});

test("assertPremisesAccess refuses with 403 when told to reveal that the record exists", () => {
  try {
    assertPremisesAccess({ premisesIds: [1] }, 2, { reveal: true });
    assert.fail("expected assertPremisesAccess to throw");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 403);
  }
});
