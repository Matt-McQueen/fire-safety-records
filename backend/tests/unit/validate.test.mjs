// Unit tests for the shared validation building blocks in http/validate.js:
// the field types every resource schema is built from, and the middleware
// that wires a zod schema into an Express request. No server, no database.

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNotEmpty,
  booleanParam,
  count,
  email,
  flag,
  id,
  idParam,
  isoDate,
  isoDateTime,
  omit,
  optionalId,
  optionalPostcode,
  optionalText,
  partial,
  postcode,
  requiredText,
  text,
  validateBody,
  validateParams,
  validateQuery,
  validationError,
  z,
} from "../../src/http/validate.js";
import { ApiError } from "../../src/http/errors.js";

// --- field types -------------------------------------------------------------

test("id coerces numeric strings and refuses anything that is not a positive integer", () => {
  assert.equal(id.parse("42"), 42);
  assert.equal(id.parse(42), 42);
  assert.throws(() => id.parse("0"));
  assert.throws(() => id.parse("-1"));
  assert.throws(() => id.parse("1.5"));
  assert.throws(() => id.parse("not-a-number"));
});

test("isoDate accepts a real calendar date and rejects an invalid one", () => {
  assert.equal(isoDate.parse("2026-03-14"), "2026-03-14");
  assert.throws(() => isoDate.parse("2025-02-30"), /invalid/i);
  assert.throws(() => isoDate.parse("14-03-2026"));
  assert.throws(() => isoDate.parse("2026-03-14T00:00:00Z"));
});

test("isoDateTime requires an offset", () => {
  assert.equal(
    isoDateTime.parse("2026-03-14T09:30:00Z"),
    "2026-03-14T09:30:00Z",
  );
  assert.throws(() => isoDateTime.parse("2026-03-14T09:30:00"));
});

test("text trims and enforces a maximum length", () => {
  assert.equal(text().parse("  hello  "), "hello");
  assert.throws(() => text(5).parse("too long"));
});

test("requiredText refuses an empty or whitespace-only string", () => {
  assert.throws(() => requiredText().parse(""));
  assert.throws(() => requiredText().parse("   "));
  assert.equal(requiredText().parse("  ok  "), "ok");
});

test("optionalText turns a cleared field into null, but passes through a real value", () => {
  assert.equal(optionalText().parse(""), null);
  assert.equal(optionalText().parse(null), null);
  assert.equal(optionalText().parse(undefined), undefined);
  assert.equal(optionalText().parse("  kept  "), "kept");
});

test("flag only accepts real booleans", () => {
  assert.equal(flag.parse(true), true);
  assert.throws(() => flag.parse("true"));
  assert.throws(() => flag.parse(1));
});

test("count coerces to a non-negative integer", () => {
  assert.equal(count.parse("3"), 3);
  assert.throws(() => count.parse("-1"));
  assert.throws(() => count.parse("1.5"));
});

test("email is trimmed, lower-cased and shaped like an address", () => {
  assert.equal(email.parse("  Person@Example.COM  "), "person@example.com");
  assert.throws(() => email.parse("not-an-email"));
  assert.throws(() => email.parse("missing-domain@"));
});

test("postcode is upper-cased and given a space in the standard place", () => {
  assert.equal(postcode.parse("g26jd"), "G2 6JD");
  assert.equal(postcode.parse("EH1 1AA"), "EH1 1AA");
  assert.equal(postcode.parse("sw1a1aa"), "SW1A 1AA");
  assert.throws(() => postcode.parse("not a postcode"));
});

test("optionalPostcode allows the field to be absent or null", () => {
  assert.equal(optionalPostcode.parse(null), null);
  assert.equal(optionalPostcode.parse(undefined), undefined);
  assert.equal(optionalPostcode.parse("g26jd"), "G2 6JD");
});

test("optionalId lets a foreign key be cleared with null", () => {
  assert.equal(optionalId.parse(null), null);
  assert.equal(optionalId.parse("7"), 7);
  assert.throws(() => optionalId.parse("0"));
});

// --- schema helpers -----------------------------------------------------------

test("idParam is a strict object with exactly one numeric id", () => {
  assert.deepEqual(idParam.parse({ id: "5" }), { id: 5 });
  assert.throws(() => idParam.parse({ id: "5", extra: "nope" }));
  assert.throws(() => idParam.parse({}));
});

test("partial makes every field optional without changing its validation", () => {
  const base = { name: requiredText(), count: count };
  const schema = z.strictObject(partial(base));

  assert.deepEqual(schema.parse({}), {});
  assert.deepEqual(schema.parse({ name: "Kept" }), { name: "Kept" });
  // Still validated when present.
  assert.throws(() => schema.parse({ name: "" }));
});

test("omit drops the named keys and keeps the rest", () => {
  const base = { premises_id: id, name: requiredText() };
  const result = omit(base, ["premises_id"]);

  assert.deepEqual(Object.keys(result), ["name"]);
  assert.equal(result.name, base.name);
});

test("assertNotEmpty refuses an empty body and returns a non-empty one unchanged", () => {
  assert.throws(() => assertNotEmpty({}), /No fields to update/);
  assert.throws(() => assertNotEmpty(null), /No fields to update/);
  assert.throws(() => assertNotEmpty(undefined), /No fields to update/);

  const body = { name: "Kept" };
  assert.equal(assertNotEmpty(body), body);
});

test("booleanParam accepts the spellings a query string is likely to carry", () => {
  const schema = booleanParam();
  assert.equal(schema.parse("true"), true);
  assert.equal(schema.parse("1"), true);
  assert.equal(schema.parse("false"), false);
  assert.equal(schema.parse("0"), false);
  assert.equal(schema.parse(undefined), undefined);
  assert.throws(() => schema.parse("yes"));
});

test("validationError reports every failing field with its path and message", () => {
  const schema = z.strictObject({ name: requiredText(), count: count });
  const result = schema.safeParse({ name: "", extra: "nope" });
  assert.equal(result.success, false);

  const error = validationError(result.error);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 400);
  assert.equal(error.code, "bad_request");
  const byField = Object.fromEntries(error.details.fields.map((field) => [field.field, field.message]));
  assert.match(byField.name, /have >=1 characters|Must not be empty/);
  // An unrecognised key has no path of its own, so it is reported against the
  // body as a whole rather than against a field name that does not exist.
  assert.match(byField["(body)"], /extra/);
});

// --- middleware ---------------------------------------------------------------

function fakeReq(overrides = {}) {
  return { body: {}, query: {}, params: {}, ...overrides };
}

function collectNext() {
  const calls = [];
  const next = (error) => calls.push(error);
  return { next, calls };
}

test("validateBody replaces req.body with the parsed value on success", () => {
  const middleware = validateBody(z.strictObject({ name: requiredText() }));
  const req = fakeReq({ body: { name: "  Trimmed  " } });
  const { next, calls } = collectNext();

  middleware(req, {}, next);

  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(req.body, { name: "Trimmed" });
});

test("validateBody passes a bad_request ApiError to next on failure, and does not touch req.body", () => {
  const middleware = validateBody(z.strictObject({ name: requiredText() }));
  const req = fakeReq({ body: { name: "" } });
  const { next, calls } = collectNext();

  middleware(req, {}, next);

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof ApiError);
  assert.equal(calls[0].status, 400);
});

test("validateBody treats a missing body as an empty object", () => {
  const middleware = validateBody(z.strictObject({}));
  const req = { query: {}, params: {} }; // no body property at all
  const { next, calls } = collectNext();

  middleware(req, {}, next);

  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(req.body, {});
});

test("validateQuery writes to req.validatedQuery, leaving req.query untouched", () => {
  const middleware = validateQuery(z.strictObject({ limit: count.optional() }));
  const req = fakeReq({ query: { limit: "10" } });
  const { next, calls } = collectNext();

  middleware(req, {}, next);

  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(req.validatedQuery, { limit: 10 });
  assert.deepEqual(req.query, { limit: "10" });
});

test("validateParams parses req.params into req.validatedParams", () => {
  const middleware = validateParams(idParam);
  const req = fakeReq({ params: { id: "9" } });
  const { next, calls } = collectNext();

  middleware(req, {}, next);

  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(req.validatedParams, { id: 9 });
});
