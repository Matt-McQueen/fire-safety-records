// Rule helpers shared across the resources.
//
// The rules themselves live with the resource they belong to; what is here is
// the vocabulary they are written in, so "this date cannot be in the future"
// means the same thing and produces the same message everywhere.
//
// Every one of these throws a 422 rather than returning false. A rule that a
// caller could ignore is not a rule.

import { notFound, ruleViolation } from "../http/errors.js";

// Dates in this domain are calendar dates, not instants: a check performed on
// the 3rd was performed on the 3rd wherever the reader is. Comparisons are
// therefore on the YYYY-MM-DD string, and "today" is the server's date.
export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function asDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function addDays(date, days) {
  const result = new Date(`${asDate(date)}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

// A record of something that happened cannot be dated in the future. Applied
// to inspections, drills, training, incidents and assessments alike: they
// record what was done, and what has not happened yet cannot have been done.
export function notInFuture(value, label) {
  if (value === null || value === undefined) return;
  if (asDate(value) > today()) {
    throw ruleViolation(`${label} cannot be in the future`);
  }
}

export function notBefore(later, earlier, laterLabel, earlierLabel) {
  if (later === null || later === undefined) return;
  if (earlier === null || earlier === undefined) return;
  if (asDate(later) < asDate(earlier)) {
    throw ruleViolation(`${laterLabel} cannot be before ${earlierLabel}`);
  }
}

// The value that will be in the column after a PATCH: the incoming one if the
// request mentions the field, otherwise what is already stored. Rules have to
// judge the resulting record, not the fragment that was sent, or a two-step
// edit could reach a state neither step was allowed to produce.
export function resulting(body, before, field) {
  return Object.hasOwn(body ?? {}, field) ? body[field] : (before?.[field] ?? null);
}

export function present(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

// --- lookups used by rules -------------------------------------------------

export async function loadRow(client, table, id, label) {
  if (id === null || id === undefined) return null;
  const { rows } = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (rows.length === 0) throw notFound(`${label} ${id} was not found`);
  return rows[0];
}

// The interval to use for a check, from check_schedules. Intervals are not set
// by legislation — they come from Scottish Government guidance and the British
// Standards — so they are configuration, looked up here rather than hard-coded.
// A schedule for this premises wins over the organisation-wide default.
export async function findSchedule(client, { premisesId, appliesTo, checkType }) {
  const { rows } = await client.query(
    `SELECT * FROM check_schedules
      WHERE applies_to = $2
        AND check_type = $3
        AND (premises_id = $1 OR premises_id IS NULL)
      ORDER BY premises_id NULLS LAST
      LIMIT 1`,
    [premisesId, appliesTo, checkType],
  );
  return rows[0] ?? null;
}

// Whether the premises is under a duty to *record* — five or more employees, or
// licensed premises, or an alterations notice in force. SSI 2006/456 regs 8, 9
// and 10(2). The underlying duties apply to everyone; only the recording is
// conditional, so this gates what the API insists on before an assessment or a
// set of arrangements can be marked as the recorded version.
export async function recordingDutyApplies(client, premisesId) {
  const { rows } = await client.query(
    "SELECT recording_duty_applies FROM premises_recording_duty WHERE premises_id = $1",
    [premisesId],
  );
  return rows[0]?.recording_duty_applies ?? false;
}

export async function countRows(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0]?.count ?? 0);
}
