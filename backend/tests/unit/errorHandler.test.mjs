// Unit tests for http/errorHandler.js: the single place an error becomes a
// response. No server and no database — audit.record is mocked out (it would
// otherwise try to write to the real database this process is configured
// against), so what is asserted here is purely what errorHandler itself
// decides: the status, the body shape, and when the audit trail is told.
//
// Requires --experimental-test-module-mocks (set in package.json's test:unit
// and test:coverage scripts). The mock has to be registered, and the module
// under test imported, exactly once at the top of the file: ES modules are
// cached by resolved specifier, so a *second* dynamic import of
// errorHandler.js within the same process would just return the same cached
// module — re-mocking auditLog.js partway through the file would not change
// what that already-loaded copy of errorHandler.js is bound to.

import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../../src/http/errors.js";

const record = mock.fn();
mock.module("../../src/audit/auditLog.js", {
  exports: { record, redact: (v) => v, changedFields: () => ({}) },
});

const { errorHandler, notFoundHandler } = await import("../../src/http/errorHandler.js");
const { config } = await import("../../src/config/env.js");

beforeEach(() => {
  record.mock.resetCalls();
});

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function fakeReq(overrides = {}) {
  return { id: "req-1", method: "GET", originalUrl: "/api/premises/1", user: null, ...overrides };
}

test("notFoundHandler answers 404 with the method and path that missed", () => {
  const req = fakeReq({ method: "PUT", path: "/api/nowhere" });
  const res = fakeRes();

  notFoundHandler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, "not_found");
  assert.match(res.body.error.message, /PUT \/api\/nowhere/);
  assert.equal(res.body.error.requestId, "req-1");
});

test("an ApiError below 500 (and not 401/403) is reported as-is, with no audit entry", () => {
  const req = fakeReq();
  const res = fakeRes();
  const error = new ApiError(422, "rule_violation", "A business rule refused this", { field: "x" });

  errorHandler(error, req, res, () => {});

  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.body, {
    error: {
      code: "rule_violation",
      message: "A business rule refused this",
      requestId: "req-1",
      details: { field: "x" },
    },
  });
  assert.equal(record.mock.calls.length, 0);
});

test("a 401 is recorded to the audit trail as denied", () => {
  const req = fakeReq({ user: { id: 9 } });
  errorHandler(new ApiError(401, "unauthorised", "Access token is not valid"), req, fakeRes(), () => {});

  assert.equal(record.mock.calls.length, 1);
  const [entry] = record.mock.calls[0].arguments;
  assert.equal(entry.outcome, "denied");
  assert.equal(entry.user, req.user);
  assert.equal(entry.detail.code, "unauthorised");
});

test("a 403 is also recorded to the audit trail as denied", () => {
  errorHandler(new ApiError(403, "forbidden", "Not allowed"), fakeReq(), fakeRes(), () => {});

  assert.equal(record.mock.calls.length, 1);
  assert.equal(record.mock.calls[0].arguments[0].outcome, "denied");
});

test("an unrecognised error becomes a 500, and is logged and audited as a failure", (t) => {
  const errorSpy = t.mock.method(console, "error", () => {});
  const req = fakeReq();
  const res = fakeRes();

  errorHandler(new Error("Something exploded"), req, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, "internal_error");
  // The message given to the client is generic; the real one only goes to the
  // server console and the audit trail.
  assert.doesNotMatch(res.body.error.message, /exploded/);
  assert.equal(errorSpy.mock.calls.length, 1);
  assert.equal(record.mock.calls.length, 1);
  assert.equal(record.mock.calls[0].arguments[0].outcome, "failure");
  assert.equal(record.mock.calls[0].arguments[0].detail.message, "Something exploded");
});

test("a 500's response carries a truncated stack outside production, but never in production", (t) => {
  t.mock.method(console, "error", () => {});
  const error = new Error("boom");
  error.stack = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");

  const original = config.isProduction;
  try {
    config.isProduction = false;
    const dev = fakeRes();
    errorHandler(error, fakeReq(), dev, () => {});
    assert.ok(Array.isArray(dev.body.error.stack));
    assert.ok(dev.body.error.stack.length <= 8);

    config.isProduction = true;
    const prod = fakeRes();
    errorHandler(error, fakeReq(), prod, () => {});
    assert.equal("stack" in prod.body.error, false);
  } finally {
    config.isProduction = original;
  }
});

test("a 4xx response never carries a stack, even outside production", () => {
  const res = fakeRes();
  errorHandler(new ApiError(404, "not_found", "Record not found"), fakeReq(), res, () => {});
  assert.equal("stack" in res.body.error, false);
});

test("when the response has already started, the error is passed on instead of being written twice", () => {
  const res = fakeRes();
  res.headersSent = true;
  const calls = [];
  const next = (error) => calls.push(error);
  const error = new ApiError(400, "bad_request", "irrelevant");

  errorHandler(error, fakeReq(), res, next);

  assert.equal(res.statusCode, null, "status/json must not be called a second time");
  assert.deepEqual(calls, [error]);
});

test("asApiError translates a database constraint error the same way translateDatabaseError does", () => {
  const res = fakeRes();
  errorHandler({ code: "23505", constraint: "users_email_key" }, fakeReq(), res, () => {});
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, "conflict");
});

test("asApiError recognises the errors express.json and a malformed URL raise", () => {
  const parseFailed = fakeRes();
  errorHandler({ type: "entity.parse.failed" }, fakeReq(), parseFailed, () => {});
  assert.equal(parseFailed.statusCode, 400);
  assert.equal(parseFailed.body.error.code, "bad_request");

  const tooLarge = fakeRes();
  errorHandler({ type: "entity.too.large" }, fakeReq(), tooLarge, () => {});
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.body.error.code, "payload_too_large");

  const badUri = fakeRes();
  errorHandler({ status: 400, name: "URIError" }, fakeReq(), badUri, () => {});
  assert.equal(badUri.statusCode, 400);
  assert.match(badUri.body.error.message, /URL is malformed/);
});
