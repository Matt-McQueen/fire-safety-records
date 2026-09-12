// Append-only audit trail.
//
// Fire safety records are evidence that a duty was discharged, so who changed
// what and when is part of the record. Every write, every authentication event
// and every refused request goes in here.
//
// Writing the trail must never be the reason a request fails, so a failure to
// log is reported to the server console and swallowed. When a `client` is
// given the entry joins that transaction and is rolled back with it, which is
// what we want for a change that did not happen.

import { pool } from "../db/db.js";

const INSERT = `
  INSERT INTO audit_log
    (user_id, user_email, action, resource, resource_id,
     premises_id, outcome, request_id, ip_address, detail)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

// Anything matching these never reaches the trail, whatever a caller passes.
const REDACTED = /password|token|secret|hash|authorization|cookie/i;

export function redact(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = REDACTED.test(key) ? "[redacted]" : redact(entry);
  }
  return result;
}

export async function record(
  { user, action, resource, resourceId, premisesId, outcome = "success", request, detail },
  client,
) {
  const params = [
    field(user, "id"),
    field(user, "email"),
    action,
    orNull(resource),
    idParam(resourceId),
    orNull(premisesId),
    outcome,
    field(request, "id"),
    field(request, "ip"),
    detailParam(detail),
  ];

  try {
    await (client ?? pool).query(INSERT, params);
  } catch (error) {
    console.error("Failed to write audit entry", { action, resource, error: error.message });
  }
}

// The pieces of one audit_log row: null in place of anything absent, so
// `record` itself never has to think about which fields need a default.
function orNull(value) {
  return value ?? null;
}

function field(obj, key) {
  return obj?.[key] ?? null;
}

function idParam(value) {
  return value === undefined || value === null ? null : String(value);
}

function detailParam(detail) {
  return detail === undefined ? null : JSON.stringify(redact(detail));
}

// The fields a change actually altered, so the trail says what moved rather
// than restating the whole row. Only keys present in `after` are compared, so
// a PATCH that touched three columns records three columns.
export function changedFields(before, after) {
  const changes = {};
  for (const [key, next] of Object.entries(after ?? {})) {
    const previous = before?.[key];
    if (!sameValue(previous, next)) {
      changes[key] = { from: normalise(previous), to: normalise(next) };
    }
  }
  return changes;
}

// Dates arrive from the client as strings and from Postgres as Date objects,
// so both sides are reduced to a comparable form first.
function normalise(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function sameValue(a, b) {
  return String(normalise(a) ?? "") === String(normalise(b) ?? "");
}
