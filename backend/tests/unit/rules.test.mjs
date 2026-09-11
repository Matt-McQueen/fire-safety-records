// Unit tests for the date and value helpers in domain/rules.js.
//
// Unlike tests/rules.test.mjs (which drives these rules through the live API
// and a real database), these call the pure helpers directly: no server, no
// pool, no network. They exist to pin down the exact semantics — what counts
// as "in the future", what a PATCH-vs-stored value resolves to — quickly and
// in isolation from everything the integration suite also has to set up.

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, asDate, notBefore, notInFuture, present, resulting, today } from "../../src/domain/rules.js";

test("today returns the current date as YYYY-MM-DD", () => {
  const value = today();
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(value, new Date().toISOString().slice(0, 10));
});

test("asDate normalises Date objects, strings and timestamps to a plain date", () => {
  assert.equal(asDate("2026-03-14"), "2026-03-14");
  assert.equal(asDate("2026-03-14T09:30:00.000Z"), "2026-03-14");
  assert.equal(asDate(new Date("2026-03-14T00:00:00Z")), "2026-03-14");
  assert.equal(asDate(null), null);
  assert.equal(asDate(undefined), null);
});

test("addDays moves a calendar date forward or back across month and year boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-10", -10), "2026-02-28");
  assert.equal(addDays("2026-06-15", 0), "2026-06-15");
});

test("notInFuture accepts today and the past, and refuses tomorrow", () => {
  assert.doesNotThrow(() => notInFuture(today(), "Occurred on"));
  assert.doesNotThrow(() => notInFuture(addDays(today(), -1), "Occurred on"));
  assert.doesNotThrow(() => notInFuture(null, "Occurred on"));
  assert.doesNotThrow(() => notInFuture(undefined, "Occurred on"));

  assert.throws(
    () => notInFuture(addDays(today(), 1), "Occurred on"),
    /Occurred on cannot be in the future/,
  );
});

test("notInFuture's message names the field it was called for", () => {
  assert.throws(() => notInFuture(addDays(today(), 5), "Carried out on"), /Carried out on cannot be in the future/);
});

test("notBefore refuses the later date only when it actually precedes the earlier one", () => {
  assert.doesNotThrow(() => notBefore("2026-02-01", "2026-01-01", "End", "Start"));
  assert.doesNotThrow(() => notBefore("2026-01-01", "2026-01-01", "End", "Start"));
  assert.throws(() => notBefore("2025-12-31", "2026-01-01", "End", "Start"), /End cannot be before Start/);
});

test("notBefore is a no-op when either side is absent", () => {
  assert.doesNotThrow(() => notBefore(null, "2026-01-01", "End", "Start"));
  assert.doesNotThrow(() => notBefore("2026-01-01", null, "End", "Start"));
  assert.doesNotThrow(() => notBefore(undefined, undefined, "End", "Start"));
});

test("resulting prefers the incoming body over the stored row, but only when the field is present", () => {
  const before = { status: "draft", summary: "Old" };

  assert.equal(resulting({ status: "current" }, before, "status"), "current");
  // Not mentioned in the body: falls back to what is already stored.
  assert.equal(resulting({ status: "current" }, before, "summary"), "Old");
  // Explicitly cleared: the body's null wins, it is not treated as "absent".
  assert.equal(resulting({ summary: null }, before, "summary"), null);
});

test("resulting falls back to null when there is no stored row either (a create)", () => {
  assert.equal(resulting({}, null, "status"), null);
  assert.equal(resulting({ status: "draft" }, null, "status"), "draft");
});

test("present distinguishes a meaningful value from blank or absent", () => {
  assert.equal(present("some text"), true);
  assert.equal(present("  padded  "), true);
  assert.equal(present(0), true);
  assert.equal(present(false), true);

  assert.equal(present(""), false);
  assert.equal(present("   "), false);
  assert.equal(present(null), false);
  assert.equal(present(undefined), false);
});
