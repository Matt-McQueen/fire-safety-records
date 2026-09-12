// The compliance position for a premises, computed by the API.
//
// This is the endpoint the brief is really about: no client works out whether a
// review is overdue, whether a Schedule 2 measure has no recorded arrangement,
// or whether a RIDDOR report is outstanding. The rules are here, expressed once,
// against the same data every other endpoint uses.
//
// What it reports is whether the *records* the legislation expects are present
// and current. That is not the same as compliance: whether an assessment is
// suitable and sufficient, and whether the measures are adequate, is a judgement
// for a competent person. The response says so.

import { pool } from "../db/db.js";
import { notFound } from "../http/errors.js";
import { assertPremisesAccess } from "../auth/middleware.js";

// Each entry is one thing the API can check, with the provision it answers to.
// `status` is one of: ok, attention, missing, not_required.
export async function complianceForPremises(premisesId, user) {
  const { rows: premisesRows } = await pool.query(
    `SELECT p.*, d.recording_duty_applies, d.trigger_five_or_more_employees,
            d.trigger_licensed_premises, d.trigger_alterations_notice
       FROM premises p
       JOIN premises_recording_duty d ON d.premises_id = p.id
      WHERE p.id = $1`,
    [premisesId],
  );
  const premises = premisesRows[0];
  if (!premises) throw notFound(`Premises ${premisesId} was not found`);
  assertPremisesAccess(user, premisesId);

  const mustRecord = premises.recording_duty_applies;
  const employees = premises.employee_count ?? 0;

  const [
    assessment,
    outstandingMeasures,
    arrangementGaps,
    equipmentState,
    routeState,
    trainingState,
    drillState,
    incidentState,
    noticeState,
    documents,
  ] = await Promise.all([
    currentAssessment(premisesId),
    measures(premisesId),
    missingArrangements(premisesId),
    equipment(premisesId),
    escapeRoutes(premisesId),
    training(premisesId),
    drills(premisesId),
    incidents(premisesId),
    notices(premisesId),
    documentVersions(premisesId),
  ]);

  const checks = [
    ...fireRiskAssessmentChecks(assessment, mustRecord),
    recordingDutyCheck(premises, mustRecord),
    outstandingMeasuresCheck(outstandingMeasures),
    arrangementsCheck(arrangementGaps, mustRecord),
    equipmentCheck(equipmentState),
    escapeRoutesCheck(routeState),
    emergencyProceduresCheck(documents),
    fireDrillsCheck(drillState),
    trainingCheck(trainingState),
    healthSafetyPolicyCheck(employees, documents),
    riddorReportsCheck(incidentState),
    enforcementNoticesCheck(noticeState),
  ];

  const counts = { ok: 0, attention: 0, missing: 0, not_required: 0 };
  for (const check of checks) counts[check.status] += 1;

  return {
    premises: { id: premises.id, name: premises.name, employee_count: premises.employee_count },
    recording_duty_applies: mustRecord,
    generated_at: new Date().toISOString(),
    summary: counts,
    checks,
    // Repeated in every response rather than left to the reader: holding the
    // records is not the same as complying with the duties.
    caveat:
      "This reports whether the records the legislation expects are present and current. Whether the assessment is suitable and sufficient, and whether the fire safety measures are adequate, is a judgement for a competent person.",
  };
}

// --- the individual checks --------------------------------------------------

// --- the assessment itself (SSI 2006/456 regs 3, 8, 9) ----------------------
function fireRiskAssessmentChecks(assessment, mustRecord) {
  if (!assessment) return [missingAssessmentCheck(mustRecord)];

  const checks = [currentAssessmentCheck(assessment)];

  // Reg 9(1)(a) requires the record to include the significant findings.
  if (mustRecord && !assessment.recorded_on) {
    checks.push({
      key: "assessment_recorded",
      provision: "SSI 2006/456 reg 8",
      status: "missing",
      summary:
        "The duty to record applies to this premises, but the current assessment has no recorded_on date.",
    });
  }

  return checks;
}

function currentAssessmentCheck(assessment) {
  return {
    key: "fire_risk_assessment",
    provision: "SSI 2006/456 regs 3, 8, 9",
    status: assessment.review_overdue ? "attention" : "ok",
    summary: assessment.review_overdue
      ? `The current assessment was due for review on ${asDate(assessment.next_review_due)}.`
      : `Assessment ${assessment.reference ?? assessment.id} is current, next review ${asDate(assessment.next_review_due) ?? "not set"}.`,
    detail: {
      id: assessment.id,
      carried_out_on: asDate(assessment.carried_out_on),
      recorded_on: asDate(assessment.recorded_on),
      next_review_due: asDate(assessment.next_review_due),
      significant_findings: Number(assessment.finding_count),
    },
  };
}

function missingAssessmentCheck(mustRecord) {
  return {
    key: "fire_risk_assessment",
    provision: "Fire (Scotland) Act 2005 s.53; SSI 2006/456 regs 3, 8",
    status: "missing",
    summary: mustRecord
      ? "No current fire risk assessment is recorded, and this premises is under a duty to record one."
      : "No current fire risk assessment is recorded. The duty to carry one out applies whether or not it must be recorded.",
  };
}

function recordingDutyCheck(premises, mustRecord) {
  return {
    key: "recording_duty",
    provision: "SSI 2006/456 regs 8, 9, 10(2)",
    status: "ok",
    summary: mustRecord
      ? `The duty to record applies: ${triggerText(premises)}.`
      : "The duty to record does not apply. The underlying duties still do; only the recording is conditional.",
    detail: {
      applies: mustRecord,
      five_or_more_employees: premises.trigger_five_or_more_employees,
      licensed_premises: premises.trigger_licensed_premises,
      alterations_notice_in_force: premises.trigger_alterations_notice,
    },
  };
}

// --- measures arising from the assessment -----------------------------------
function outstandingMeasuresCheck(outstandingMeasures) {
  return {
    key: "outstanding_measures",
    provision: "SSI 2006/456 reg 9(1)(a)",
    status: outstandingMeasures.overdue > 0 ? "attention" : "ok",
    summary:
      outstandingMeasures.overdue > 0
        ? `${outstandingMeasures.overdue} planned measure(s) are past their target date.`
        : `${outstandingMeasures.planned} planned measure(s), none overdue.`,
    detail: outstandingMeasures,
  };
}

// --- arrangements (reg 10) ---------------------------------------------------
function arrangementsCheck(arrangementGaps, mustRecord) {
  return {
    key: "fire_safety_arrangements",
    provision: "SSI 2006/456 reg 10",
    status: arrangementGaps.length === 0 ? "ok" : mustRecord ? "missing" : "attention",
    summary:
      arrangementGaps.length === 0
        ? "Every Schedule 2 measure has a current recorded arrangement."
        : `${arrangementGaps.length} Schedule 2 measure(s) have no current arrangement recorded.`,
    detail: { missing: arrangementGaps },
  };
}

// --- maintenance (regs 12, 13) ----------------------------------------------
function equipmentCheck(equipmentState) {
  return {
    key: "equipment_checks",
    provision: "SSI 2006/456 reg 12",
    status: equipmentState.overdue > 0 || equipmentState.unresolved_defects > 0 ? "attention" : "ok",
    summary:
      equipmentState.overdue > 0 || equipmentState.unresolved_defects > 0
        ? `${equipmentState.overdue} item(s) overdue a check and ${equipmentState.unresolved_defects} with an unresolved defect.`
        : `${equipmentState.in_service} item(s) in service, all checks up to date.`,
    detail: equipmentState,
  };
}

function escapeRoutesCheck(routeState) {
  return {
    key: "escape_routes",
    provision: "SSI 2006/456 reg 13",
    status: routeState.overdue > 0 || routeState.unresolved > 0 ? "attention" : "ok",
    summary:
      routeState.overdue > 0 || routeState.unresolved > 0
        ? `${routeState.overdue} route(s) overdue a check and ${routeState.unresolved} with an unresolved obstruction.`
        : `${routeState.in_service} route(s) in service, all checks up to date.`,
    detail: routeState,
  };
}

// --- procedures, drills, training, information -------------------------------
function emergencyProceduresCheck(documents) {
  return {
    key: "emergency_procedures",
    provision: "SSI 2006/456 reg 14",
    status: documents.procedures > 0 ? "ok" : "missing",
    summary:
      documents.procedures > 0
        ? `${documents.procedures} current emergency procedure(s) recorded.`
        : "No current emergency procedure is recorded.",
  };
}

function fireDrillsCheck(drillState) {
  return {
    key: "fire_drills",
    provision: "SSI 2006/456 reg 14; interval from Scottish Government guidance",
    status: drillState.status,
    summary: drillState.summary,
    detail: drillState.detail,
  };
}

function trainingCheck(trainingState) {
  return {
    key: "training",
    provision: "SSI 2006/456 reg 20",
    status: trainingState.overdue > 0 ? "attention" : trainingState.total > 0 ? "ok" : "missing",
    summary:
      trainingState.total === 0
        ? "No training is recorded for this premises."
        : trainingState.overdue > 0
          ? `${trainingState.overdue} training record(s) are past their refresher date.`
          : `${trainingState.people_trained} person(s) trained, no refreshers overdue.`,
    detail: trainingState,
  };
}

// --- the written policy (HSWA 1974 s.2(3)) ----------------------------------
function healthSafetyPolicyCheck(employees, documents) {
  return {
    key: "health_safety_policy",
    provision: "Health and Safety at Work etc. Act 1974 s.2(3)",
    status: employees < 5 ? "not_required" : documents.policies > 0 ? "ok" : "missing",
    summary:
      employees < 5
        ? `Fewer than five employees are recorded (${employees}), so the written policy duty does not apply.`
        : documents.policies > 0
          ? "A current written policy is recorded."
          : `${employees} employees are recorded, so a written policy is required and none is current.`,
  };
}

// --- incidents and enforcement ----------------------------------------------
function riddorReportsCheck(incidentState) {
  return {
    key: "riddor_reports",
    provision: "RIDDOR 2013 regs 6, 12",
    status:
      incidentState.report_overdue > 0
        ? "attention"
        : incidentState.report_outstanding > 0
          ? "attention"
          : "ok",
    summary:
      incidentState.report_outstanding === 0
        ? `${incidentState.reportable} reportable incident(s) recorded, all reported.`
        : `${incidentState.report_outstanding} reportable incident(s) have no report date, ${incidentState.report_overdue} of them past the ten-day deadline.`,
    detail: incidentState,
  };
}

function enforcementNoticesCheck(noticeState) {
  return {
    key: "enforcement_notices",
    provision: "Fire (Scotland) Act 2005 ss.62-65",
    status: noticeState.outstanding > 0 ? "attention" : "ok",
    summary:
      noticeState.outstanding > 0
        ? `${noticeState.outstanding} notice(s) in force with no compliance date recorded.`
        : noticeState.in_force > 0
          ? `${noticeState.in_force} notice(s) in force, all with compliance recorded.`
          : "No enforcement notice is in force.",
    detail: noticeState,
  };
}

// Runs `fn` over `items` with at most `limit` in flight at once, rather than
// firing every one of them at the same time.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// The same compliance position as complianceForPremises, for every premises
// the caller can reach, in one request.
//
// The dashboard used to get this by calling GET .../:id/compliance once per
// premises itself (frontend/src/pages/DashboardPage.tsx). That was fine while
// this database held a handful of premises, but complianceForPremises already
// runs ten queries per premises, so as the premises table has grown that
// page's load fanned out to ten times as many concurrent queries as there are
// premises - for an admin account, several hundred at once, on every single
// visit to "/". That's what was actually behind the connection-pool
// exhaustion this project spent a long time chasing across two database
// providers: not a shortage of pooled connections, but one page asking for
// far more of them at once than any reasonable pool size provides. Capping
// concurrency here keeps that fan-out bounded regardless of how many premises
// an account can see.
export async function complianceSummaryForAccessiblePremises(user) {
  const { rows: targets } =
    user.premisesIds === null
      ? await pool.query(`SELECT id, name FROM premises ORDER BY name`)
      : await pool.query(`SELECT id, name FROM premises WHERE id = ANY($1) ORDER BY name`, [
          user.premisesIds,
        ]);

  return mapWithConcurrency(targets, 4, async (target) => {
    const full = await complianceForPremises(target.id, user);
    return {
      premises: full.premises,
      recording_duty_applies: full.recording_duty_applies,
      summary: full.summary,
    };
  });
}

function triggerText(premises) {
  const reasons = [];
  if (premises.trigger_five_or_more_employees) reasons.push("five or more employees");
  if (premises.trigger_licensed_premises) reasons.push("the premises needs a licence or registration");
  if (premises.trigger_alterations_notice) reasons.push("an alterations notice is in force");
  return reasons.join("; ");
}

function asDate(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// --- the individual queries ------------------------------------------------

async function currentAssessment(premisesId) {
  const { rows } = await pool.query(
    `SELECT f.*,
            (f.next_review_due IS NOT NULL AND f.next_review_due < current_date) AS review_overdue,
            (SELECT count(*) FROM fra_significant_findings s
              WHERE s.fire_risk_assessment_id = f.id) AS finding_count
       FROM fire_risk_assessments f
      WHERE f.premises_id = $1 AND f.status = 'current'
      ORDER BY f.carried_out_on DESC
      LIMIT 1`,
    [premisesId],
  );
  return rows[0] ?? null;
}

async function measures(premisesId) {
  const { rows } = await pool.query(
    `SELECT
        count(*) FILTER (WHERE m.status = 'planned')::int AS planned,
        count(*) FILTER (WHERE m.status = 'taken')::int AS taken,
        count(*) FILTER (
          WHERE m.status = 'planned'
            AND m.target_date IS NOT NULL
            AND m.target_date < current_date
        )::int AS overdue
       FROM fra_measures m
       JOIN fra_significant_findings s ON s.id = m.finding_id
       JOIN fire_risk_assessments f ON f.id = s.fire_risk_assessment_id
      WHERE f.premises_id = $1 AND f.status = 'current'`,
    [premisesId],
  );
  return rows[0];
}

// Reg 10 asks for arrangements covering the fire safety measures. Any Schedule 2
// measure the premises has equipment or an assessment measure for, but no
// current arrangement, is a gap worth naming.
async function missingArrangements(premisesId) {
  const { rows } = await pool.query(
    `SELECT m.code, m.description
       FROM schedule2_measures m
      WHERE EXISTS (
              SELECT 1 FROM equipment e
               WHERE e.premises_id = $1
                 AND e.in_service
                 AND e.schedule2_measure_code = m.code
            )
        AND NOT EXISTS (
              SELECT 1 FROM fire_safety_arrangements a
               WHERE a.premises_id = $1
                 AND a.schedule2_measure_code = m.code
                 AND a.superseded_by_id IS NULL
            )
      ORDER BY m.code`,
    [premisesId],
  );
  return rows;
}

async function equipment(premisesId) {
  const { rows } = await pool.query(
    `WITH latest AS (
        SELECT DISTINCT ON (e.id)
               e.id, e.in_service, c.next_due_on, c.outcome, c.remedied_on
          FROM equipment e
          LEFT JOIN equipment_checks c ON c.equipment_id = e.id
         WHERE e.premises_id = $1 AND e.in_service
         ORDER BY e.id, c.performed_on DESC NULLS LAST, c.id DESC
     )
     SELECT count(*)::int AS in_service,
            count(*) FILTER (WHERE next_due_on IS NULL)::int AS never_checked,
            count(*) FILTER (WHERE next_due_on < current_date)::int AS overdue,
            count(*) FILTER (
              WHERE outcome IN ('fail', 'pass_with_defects') AND remedied_on IS NULL
            )::int AS unresolved_defects
       FROM latest`,
    [premisesId],
  );
  return rows[0];
}

async function escapeRoutes(premisesId) {
  const { rows } = await pool.query(
    `WITH latest AS (
        SELECT DISTINCT ON (r.id)
               r.id, c.next_due_on, c.outcome, c.remedied_on
          FROM escape_routes r
          LEFT JOIN escape_route_checks c ON c.escape_route_id = r.id
         WHERE r.premises_id = $1 AND r.in_service
         ORDER BY r.id, c.performed_on DESC NULLS LAST, c.id DESC
     )
     SELECT count(*)::int AS in_service,
            count(*) FILTER (WHERE next_due_on IS NULL)::int AS never_checked,
            count(*) FILTER (WHERE next_due_on < current_date)::int AS overdue,
            count(*) FILTER (
              WHERE outcome IN ('fail', 'pass_with_defects') AND remedied_on IS NULL
            )::int AS unresolved
       FROM latest`,
    [premisesId],
  );
  return rows[0];
}

async function training(premisesId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(DISTINCT person_id)::int AS people_trained,
            count(*) FILTER (
              WHERE next_due_on IS NOT NULL AND next_due_on < current_date
            )::int AS overdue
       FROM training_records
      WHERE premises_id = $1`,
    [premisesId],
  );
  return rows[0];
}

// No drill frequency is set by legislation, so the interval comes from
// check_schedules. Where no schedule is configured the API reports the last
// drill and says nothing about whether one is due, rather than inventing a
// number.
async function drills(premisesId) {
  const { rows } = await pool.query(
    `SELECT
        (SELECT max(held_at) FROM fire_drills WHERE premises_id = $1) AS last_held_at,
        (SELECT interval_days FROM check_schedules
          WHERE applies_to = 'fire_drill'
            AND (premises_id = $1 OR premises_id IS NULL)
          ORDER BY premises_id NULLS LAST
          LIMIT 1) AS interval_days,
        (SELECT recommended_by FROM check_schedules
          WHERE applies_to = 'fire_drill'
            AND (premises_id = $1 OR premises_id IS NULL)
          ORDER BY premises_id NULLS LAST
          LIMIT 1) AS recommended_by`,
    [premisesId],
  );
  const { last_held_at: lastHeld, interval_days: intervalDays, recommended_by: source } = rows[0];

  if (!lastHeld) {
    return {
      status: "missing",
      summary: "No fire drill is recorded for this premises.",
      detail: { last_held_at: null, interval_days: intervalDays },
    };
  }
  if (!intervalDays) {
    return {
      status: "ok",
      summary: `Last drill ${asDate(lastHeld)}. No drill interval is configured, and none is set by legislation.`,
      detail: { last_held_at: lastHeld, interval_days: null },
    };
  }

  const due = new Date(lastHeld);
  due.setUTCDate(due.getUTCDate() + intervalDays);
  const overdue = due < new Date();
  return {
    status: overdue ? "attention" : "ok",
    summary: overdue
      ? `Last drill ${asDate(lastHeld)}; the next was due ${asDate(due)} on a ${intervalDays}-day interval (${source ?? "local policy"}).`
      : `Last drill ${asDate(lastHeld)}; next due ${asDate(due)}.`,
    detail: {
      last_held_at: lastHeld,
      interval_days: intervalDays,
      next_due_on: asDate(due),
      interval_source: source,
    },
  };
}

async function incidents(premisesId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE riddor_reportable)::int AS reportable,
            count(*) FILTER (
              WHERE riddor_reportable AND riddor_reported_on IS NULL
            )::int AS report_outstanding,
            count(*) FILTER (
              WHERE riddor_reportable
                AND riddor_reported_on IS NULL
                AND COALESCE(discovered_on, occurred_on) + 10 < current_date
            )::int AS report_overdue
       FROM incidents
      WHERE premises_id = $1`,
    [premisesId],
  );
  return rows[0];
}

async function notices(premisesId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE in_force)::int AS in_force,
            count(*) FILTER (WHERE in_force AND complied_on IS NULL)::int AS outstanding
       FROM enforcement_notices
      WHERE premises_id = $1`,
    [premisesId],
  );
  return rows[0];
}

async function documentVersions(premisesId) {
  const { rows } = await pool.query(
    `SELECT
        (SELECT count(*)::int FROM emergency_procedures
          WHERE premises_id = $1 AND superseded_by_id IS NULL) AS procedures,
        (SELECT count(*)::int FROM health_safety_policies
          WHERE (premises_id = $1 OR premises_id IS NULL)
            AND superseded_by_id IS NULL) AS policies`,
    [premisesId],
  );
  return rows[0];
}
