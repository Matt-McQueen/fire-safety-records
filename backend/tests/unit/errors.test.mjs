// Unit tests for the error vocabulary in http/errors.js: each factory must
// produce the right status and code, since the error handler and every test
// that asserts on `error.code` or `error.status` depends on that mapping
// staying exact.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  ruleViolation,
  tooManyRequests,
  unauthorised,
} from "../../src/http/errors.js";

test("ApiError carries status, code, message and optional details", () => {
  const error = new ApiError(418, "teapot", "I am a teapot", { reason: "short and stout" });
  assert.ok(error instanceof Error);
  assert.equal(error.name, "ApiError");
  assert.equal(error.status, 418);
  assert.equal(error.code, "teapot");
  assert.equal(error.message, "I am a teapot");
  assert.deepEqual(error.details, { reason: "short and stout" });
});

test("ApiError omits details entirely when none are given, rather than storing undefined", () => {
  const error = new ApiError(400, "bad_request", "No details here");
  assert.equal("details" in error, false);
});

const cases = [
  [badRequest, 400, "bad_request", "The request did not pass validation"],
  [unauthorised, 401, "unauthorised", "Authentication is required"],
  [forbidden, 403, "forbidden", "You do not have access to this record"],
  [notFound, 404, "not_found", "Record not found"],
  [conflict, 409, "conflict", "Two things collided"],
  [ruleViolation, 422, "rule_violation", "A business rule refused this"],
  [tooManyRequests, 429, "too_many_requests", "Too many requests"],
];

for (const [factory, status, code, message] of cases) {
  test(`${factory.name}(message) produces a ${status} ${code}`, () => {
    const error = factory(message);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
  });
}

test("unauthorised, forbidden, notFound and tooManyRequests fall back to a sensible default message", () => {
  assert.equal(unauthorised().message, "Authentication is required");
  assert.equal(forbidden().message, "You do not have access to this record");
  assert.equal(notFound().message, "Record not found");
  assert.equal(tooManyRequests().message, "Too many requests");
});

test("badRequest and conflict and ruleViolation carry details through when given", () => {
  const details = { fields: [{ field: "name", message: "Must not be empty" }] };
  assert.deepEqual(badRequest("bad", details).details, details);
  assert.deepEqual(conflict("clash", details).details, details);
  assert.deepEqual(ruleViolation("no", details).details, details);
});
