// The fire risk assessment and everything recorded as part of it.
//
// SSI 2006/456 reg 3 requires the assessment; regs 8 and 9 require it to be
// recorded where the recording duty applies, together with the significant
// findings and the groups identified as being especially at risk. Reg 10(2)
// requires the fire safety arrangements to be recorded on the same condition.
//
// The lifecycle enforced here is draft -> current -> superseded. A draft is
// working material and may be changed freely. Publishing it makes it the
// recorded assessment and freezes what reg 9 requires to be recorded. A
// superseded assessment is the historical record and never changes again.

import { z } from "zod";
import {
  booleanParam,
  flag,
  id,
  isoDate,
  omit,
  optionalId,
  optionalText,
  partial,
  requiredText,
} from "../../http/validate.js";
import { idParam, validateParams, validateBody } from "../../http/validate.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { requireRole } from "../../auth/middleware.js";
import { conflict, notFound, ruleViolation } from "../../http/errors.js";
import { ownPremises, throughParent, throughTable } from "../scope.js";
import * as crud from "../crud.js";
import { pool, withTransaction } from "../../db/db.js";
import * as audit from "../../audit/auditLog.js";
import {
  addDays,
  countRows,
  notBefore,
  notInFuture,
  present,
  recordingDutyApplies,
  resulting,
  today,
} from "../rules.js";

const ASSESSMENT_TYPES = ["initial", "review", "revision_after_change"];
const STATUSES = ["draft", "current", "superseded"];

// Scottish Government Practical Fire Safety Guidance uses a three-point scale.
// Accepted in any case and stored capitalised, matching the existing records.
const riskRating = z
  .enum(["low", "medium", "high", "Low", "Medium", "High", "LOW", "MEDIUM", "HIGH"])
  .transform((value) => value[0].toUpperCase() + value.slice(1).toLowerCase())
  .optional()
  .nullable();

// --- fire risk assessments -------------------------------------------------

const fraFields = {
  premises_id: id,
  reference: optionalText(50),
  assessment_type: z.enum(ASSESSMENT_TYPES).optional(),
  carried_out_on: isoDate,
  carried_out_by_id: optionalId,
  assessor_external: optionalText(200),
  assessor_competence: optionalText(1000),
  next_review_due: isoDate.optional().nullable(),
  covers_young_persons: flag.optional(),
  covers_dangerous_substances: flag.optional(),
  summary: optionalText(),
};

// Once an assessment is the recorded one, the only things that may change are
// when it is next due for review and the narrative summary. Everything reg 9
// requires to be recorded is fixed at publication. `status`, `recorded_on` and
// `supersedes_id` are not accepted from a client at all: they are set by
// publishing.
const AMENDABLE_WHEN_CURRENT = new Set(["next_review_due", "summary"]);

export const fireRiskAssessments = {
  name: "fire_risk_assessments",
  label: "Fire risk assessment",
  table: "fire_risk_assessments",
  path: "/fire-risk-assessments",
  scope: ownPremises,
  timestamps: true,
  extraJoins: "JOIN premises prem ON prem.id = t.premises_id",
  computed: [
    "prem.name AS premises_name",
    // Whether a review is overdue is a property of the record, so the API says
    // so rather than leaving every client to work it out from the date.
    "(t.status = 'current' AND t.next_review_due IS NOT NULL AND t.next_review_due < current_date) AS review_overdue",
  ],
  sortable: {
    id: "t.id",
    carried_out_on: "t.carried_out_on",
    next_review_due: "t.next_review_due",
    status: "t.status",
  },
  defaultSort: "carried_out_on",
  search: ["t.reference", "t.summary", "t.assessor_external"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    { param: "status", column: "t.status", schema: z.enum(STATUSES).optional() },
    {
      param: "assessment_type",
      column: "t.assessment_type",
      schema: z.enum(ASSESSMENT_TYPES).optional(),
    },
    {
      param: "carried_out_by_id",
      column: "t.carried_out_by_id",
      schema: id.optional(),
    },
  ],
  dateRanges: [
    { param: "carried_out_on", column: "t.carried_out_on", schema: isoDate.optional() },
    { param: "next_review_due", column: "t.next_review_due", schema: isoDate.optional() },
  ],
  schemas: {
    create: z.strictObject(fraFields),
    update: z.strictObject(partial(omit(fraFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      assertAssessorNamed(body, null);
      notInFuture(body.carried_out_on, "carried_out_on");

      // An assessment always starts as a draft. Making it the recorded one is
      // a deliberate act with its own checks, not something a POST can do.
      return {
        ...body,
        status: "draft",
        // Scottish Government guidance suggests reviewing at least annually.
        // The interval is guidance, not legislation, so it is only a default:
        // a client may set any date it likes.
        next_review_due: body.next_review_due ?? addDays(body.carried_out_on, 365),
      };
    },

    beforeUpdate(body, before) {
      if (before.status === "superseded") {
        throw conflict(
          "A superseded assessment is the historical record and cannot be changed. Create a new assessment instead.",
        );
      }
      if (before.status === "current") {
        const blocked = Object.keys(body).filter((field) => !AMENDABLE_WHEN_CURRENT.has(field));
        if (blocked.length > 0) {
          throw conflict(
            `A recorded assessment cannot be rewritten. ${blocked.join(", ")} can only be changed on a draft; record a review instead.`,
            { amendable: [...AMENDABLE_WHEN_CURRENT] },
          );
        }
      }
      assertAssessorNamed(body, before);
      notInFuture(resulting(body, before, "carried_out_on"), "carried_out_on");
      return body;
    },

    beforeDelete(before) {
      if (before.status !== "draft") {
        throw conflict(
          "Only a draft assessment can be deleted. A recorded assessment is evidence that reg 3 was complied with and is kept.",
        );
      }
    },
  },

  extend(router, { permissions }) {
    // Making a draft the recorded assessment. A separate endpoint because it
    // is a state change with its own preconditions, not a field edit.
    router.post(
      "/:id/publish",
      // Publishing is what turns working material into the record the
      // enforcing authority may ask for, so it is a manager's decision.
      requireRole("manager"),
      validateParams(idParam),
      validateBody(
        z.strictObject({
          recorded_on: isoDate.optional(),
          // Only meaningful where an assessment is already current here.
          assessment_type: z.enum(["review", "revision_after_change"]).optional(),
        }),
      ),
      asyncHandler(async (req, res) => {
        const result = await publishAssessment(req.validatedParams.id, req.body, {
          user: req.user,
          request: req,
        });
        res.json({ data: result });
      }),
    );

    // The whole assessment in one response: findings with their measures, and
    // the people and groups identified as especially at risk. This is the
    // shape reg 9 asks for, and assembling it here means a client cannot
    // assemble it wrongly.
    router.get(
      "/:id/full",
      requireRole(permissions.read),
      validateParams(idParam),
      asyncHandler(async (req, res) => {
        res.json({ data: await fullAssessment(req.validatedParams.id, req.user) });
      }),
    );
  },
};

function assertAssessorNamed(body, before) {
  const internal = resulting(body, before, "carried_out_by_id");
  const external = resulting(body, before, "assessor_external");
  if (!present(internal) && !present(external)) {
    // Reg 3 requires a suitable and sufficient assessment and s.53 turns on
    // competence. An assessment with nobody's name against it evidences
    // neither.
    throw ruleViolation(
      "The assessment must name who carried it out: set carried_out_by_id for a person on the record, or assessor_external for an outside assessor",
    );
  }
}

// Reg 9(1)(a): the significant findings of the assessment must be recorded.
// An assessment recorded with none has not recorded them.
async function assertFindingsRecorded(client, assessment, assessmentId) {
  const findings = await countRows(
    client,
    "SELECT count(*) FROM fra_significant_findings WHERE fire_risk_assessment_id = $1",
    [assessmentId],
  );
  if (findings === 0) {
    throw ruleViolation(
      "This premises is under a duty to record, so the assessment must record at least one significant finding before it can be published (SSI 2006/456 reg 9(1)(a)). Record that no significant risk was found if that is the conclusion.",
    );
  }
  if (!present(assessment.assessor_competence)) {
    throw ruleViolation(
      "assessor_competence must record what the assessor's competence rests on before the assessment is recorded",
    );
  }
}

// Regs 6 and 7, and DSEAR: where dangerous substances are present the
// assessment has to have considered them. If the premises holds any, an
// assessment that says it does not cover them is not the assessment the
// regulations require.
async function assertDangerousSubstancesCovered(client, assessment, premisesId) {
  const substances = await countRows(
    client,
    "SELECT count(*) FROM dangerous_substances WHERE premises_id = $1",
    [premisesId],
  );
  if (substances > 0 && !assessment.covers_dangerous_substances) {
    throw ruleViolation(
      `This premises has ${substances} dangerous substance record(s), so the assessment must set covers_dangerous_substances (SSI 2006/456 regs 6-7).`,
    );
  }
}

// Reg 5 and the Management of Health and Safety at Work Regulations: young
// persons get particular consideration. If the assessment itself lists one as
// especially at risk, it plainly covers them, so the flag must say so.
async function assertYoungPersonsCovered(client, assessment, assessmentId) {
  const youngPersons = await countRows(
    client,
    `SELECT count(*) FROM fra_persons_at_risk
      WHERE fire_risk_assessment_id = $1 AND category = 'young_person'`,
    [assessmentId],
  );
  if (youngPersons > 0 && !assessment.covers_young_persons) {
    throw ruleViolation(
      "The assessment identifies a young person as especially at risk, so covers_young_persons must be set.",
    );
  }
}

// An assessment that follows another is a review or a revision, not an
// initial assessment. Recording it as initial would misdescribe the history.
function resolveAssessmentType(body, assessment, superseded) {
  let assessmentType = body.assessment_type ?? assessment.assessment_type;
  if (superseded && assessmentType === "initial") {
    throw ruleViolation(
      "This premises already has a recorded assessment, so this one is a review or a revision after a change, not an initial assessment. Set assessment_type accordingly.",
      { supersedes_id: superseded.id },
    );
  }
  if (!superseded && assessmentType !== "initial") {
    assessmentType = "initial";
  }
  return assessmentType;
}

// The rules that decide whether a draft may become the recorded assessment.
async function publishAssessment(assessmentId, body, { user, request }) {
  return withTransaction(async (client) => {
    const assessment = await crud.fetchScoped(fireRiskAssessments, assessmentId, {
      user,
      client,
      forUpdate: true,
    });

    if (assessment.status !== "draft") {
      throw conflict(`This assessment is already ${assessment.status}.`);
    }

    const premisesId = assessment.premises_id;
    const mustRecord = await recordingDutyApplies(client, premisesId);
    const recordedOn = body.recorded_on ?? today();
    notInFuture(recordedOn, "recorded_on");
    notBefore(recordedOn, assessment.carried_out_on, "recorded_on", "carried_out_on");

    if (mustRecord) await assertFindingsRecorded(client, assessment, assessmentId);
    await assertDangerousSubstancesCovered(client, assessment, premisesId);
    await assertYoungPersonsCovered(client, assessment, assessmentId);

    return recordAsCurrent(client, { assessmentId, body, assessment, premisesId, mustRecord, recordedOn, user, request });
  });
}

// Finds the assessment currently recorded for this premises (if any) and
// marks it superseded, so the new one can point back to it.
async function supersedeCurrentAssessment(client, premisesId) {
  const { rows: currentRows } = await client.query(
    `SELECT id, assessment_type FROM fire_risk_assessments
      WHERE premises_id = $1 AND status = 'current'
      FOR UPDATE`,
    [premisesId],
  );
  const superseded = currentRows[0] ?? null;
  if (superseded) {
    await client.query(
      "UPDATE fire_risk_assessments SET status = 'superseded', updated_at = now() WHERE id = $1",
      [superseded.id],
    );
  }
  return superseded;
}

// Writes this assessment as the new current assessment (having already
// superseded the last one) and audits the whole publication.
async function recordAsCurrent(client, { assessmentId, body, assessment, premisesId, mustRecord, recordedOn, user, request }) {
  const superseded = await supersedeCurrentAssessment(client, premisesId);
  const assessmentType = resolveAssessmentType(body, assessment, superseded);

  const { rows } = await client.query(
    `UPDATE fire_risk_assessments
        SET status = 'current',
            assessment_type = $2,
            recorded_on = $3,
            supersedes_id = $4,
            updated_at = now()
      WHERE id = $1
    RETURNING *`,
    [assessmentId, assessmentType, mustRecord ? recordedOn : (body.recorded_on ?? null), superseded?.id ?? null],
  );

  await audit.record(
    {
      user,
      action: "fire_risk_assessments.publish",
      resource: "fire_risk_assessments",
      resourceId: assessmentId,
      premisesId,
      request,
      detail: {
        supersedes_id: superseded?.id ?? null,
        assessment_type: assessmentType,
        recording_duty_applies: mustRecord,
      },
    },
    client,
  );

  return { ...rows[0], superseded_id: superseded?.id ?? null, recording_duty_applies: mustRecord };
}

async function fullAssessment(assessmentId, user) {
  const assessment = await crud.fetchScoped(fireRiskAssessments, assessmentId, { user });

  const { rows: findings } = await pool.query(
    `SELECT f.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', m.id,
                  'schedule2_measure_code', m.schedule2_measure_code,
                  'description', m.description,
                  'status', m.status,
                  'responsible_person_id', m.responsible_person_id,
                  'target_date', m.target_date,
                  'completed_on', m.completed_on,
                  'overdue', m.status = 'planned'
                                AND m.target_date IS NOT NULL
                                AND m.target_date < current_date
                ) ORDER BY m.id
              ) FILTER (WHERE m.id IS NOT NULL),
              '[]'
            ) AS measures
       FROM fra_significant_findings f
       LEFT JOIN fra_measures m ON m.finding_id = f.id
      WHERE f.fire_risk_assessment_id = $1
      GROUP BY f.id
      ORDER BY f.id`,
    [assessmentId],
  );

  const { rows: personsAtRisk } = await pool.query(
    `SELECT r.*, p.full_name AS person_name
       FROM fra_persons_at_risk r
       LEFT JOIN people p ON p.id = r.person_id
      WHERE r.fire_risk_assessment_id = $1
      ORDER BY r.id`,
    [assessmentId],
  );

  return { ...strip(assessment), significant_findings: findings, persons_at_risk: personsAtRisk };
}

function strip(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith("_")) result[key] = value;
  }
  return result;
}

// --- children of an assessment ---------------------------------------------

// Findings and the people identified as especially at risk are what reg 9
// requires to be recorded. Once the assessment is the recorded one they are
// fixed; a change of substance means a new assessment, which is what a review
// is for.
async function assertParentDraft(client, assessmentId, what) {
  const { rows } = await client.query(
    "SELECT id, status FROM fire_risk_assessments WHERE id = $1 FOR UPDATE",
    [assessmentId],
  );
  const parent = rows[0];
  if (!parent) throw notFound(`Fire risk assessment ${assessmentId} was not found`);
  if (parent.status !== "draft") {
    throw conflict(
      `The assessment is ${parent.status}, so ${what} recorded against it cannot be changed. Record a review as a new draft assessment instead.`,
    );
  }
  return parent;
}

const findingFields = {
  fire_risk_assessment_id: id,
  finding: requiredText(2000),
  location: optionalText(300),
  ignition_source: optionalText(300),
  fuel_source: optionalText(300),
  persons_affected: optionalText(500),
  risk_rating: riskRating,
};

export const significantFindings = {
  name: "fra_significant_findings",
  label: "Significant finding",
  table: "fra_significant_findings",
  path: "/fra-significant-findings",
  scope: throughTable({
    table: "fire_risk_assessments",
    key: "fire_risk_assessment_id",
    alias: "fra",
    missing: "The fire risk assessment was not found",
  }),
  sortable: { id: "t.id", risk_rating: "t.risk_rating" },
  defaultSort: "id",
  search: ["t.finding", "t.location"],
  filters: [
    {
      param: "fire_risk_assessment_id",
      column: "t.fire_risk_assessment_id",
      schema: id.optional(),
    },
    { param: "premises_id", column: "fra.premises_id", schema: id.optional() },
    { param: "risk_rating", column: "t.risk_rating", schema: z.string().max(20).optional() },
  ],
  schemas: {
    create: z.strictObject(findingFields),
    update: z.strictObject(partial(omit(findingFields, ["fire_risk_assessment_id"]))),
  },
  rules: {
    async beforeCreate(body, { client }) {
      await assertParentDraft(client, body.fire_risk_assessment_id, "findings");
      return body;
    },
    async beforeUpdate(body, before, { client }) {
      await assertParentDraft(client, before.fire_risk_assessment_id, "findings");
      return body;
    },
    async beforeDelete(before, { client }) {
      await assertParentDraft(client, before.fire_risk_assessment_id, "findings");
    },
  },
};

const measureFields = {
  finding_id: id,
  schedule2_measure_code: optionalText(10),
  description: requiredText(2000),
  status: z.enum(["taken", "planned"]),
  responsible_person_id: optionalId,
  target_date: isoDate.optional().nullable(),
  completed_on: isoDate.optional().nullable(),
};

export const fraMeasures = {
  name: "fra_measures",
  label: "Measure",
  table: "fra_measures",
  path: "/fra-measures",
  scope: throughParent({
    key: "finding_id",
    joins: `JOIN fra_significant_findings sf ON sf.id = t.finding_id
            JOIN fire_risk_assessments fra ON fra.id = sf.fire_risk_assessment_id`,
    premisesExpr: "fra.premises_id",
    premisesSql: `SELECT fra.premises_id
                    FROM fra_significant_findings sf
                    JOIN fire_risk_assessments fra ON fra.id = sf.fire_risk_assessment_id
                   WHERE sf.id = $1`,
    missing: "The significant finding was not found",
  }),
  computed: [
    "fra.id AS fire_risk_assessment_id",
    "(t.status = 'planned' AND t.target_date IS NOT NULL AND t.target_date < current_date) AS overdue",
  ],
  sortable: { id: "t.id", target_date: "t.target_date", status: "t.status" },
  defaultSort: "target_date",
  search: ["t.description"],
  filters: [
    { param: "finding_id", column: "t.finding_id", schema: id.optional() },
    { param: "premises_id", column: "fra.premises_id", schema: id.optional() },
    {
      param: "fire_risk_assessment_id",
      column: "sf.fire_risk_assessment_id",
      schema: id.optional(),
    },
    { param: "status", column: "t.status", schema: z.enum(["taken", "planned"]).optional() },
    {
      param: "schedule2_measure_code",
      column: "t.schedule2_measure_code",
      schema: z.string().max(10).optional(),
    },
  ],
  dateRanges: [{ param: "target_date", column: "t.target_date", schema: isoDate.optional() }],
  schemas: {
    create: z.strictObject(measureFields),
    update: z.strictObject(partial(omit(measureFields, ["finding_id"]))),
  },
  rules: {
    // Unlike a finding, a measure may be added to and updated on a recorded
    // assessment: reg 9(1)(a) records the measures taken or to be taken, and
    // a planned measure becoming a taken one is that record being kept up to
    // date rather than the assessment being rewritten. A superseded assessment
    // is still closed.
    async beforeCreate(body, { client }) {
      await assertAssessmentNotSuperseded(client, body.finding_id);
      assertMeasureCoherent(body, null);
      return body;
    },
    async beforeUpdate(body, before, { client }) {
      await assertAssessmentNotSuperseded(client, before.finding_id);
      assertMeasureCoherent(body, before);
      return body;
    },
    async beforeDelete(before, { client }) {
      await assertAssessmentNotSuperseded(client, before.finding_id);
    },
  },
};

async function assertAssessmentNotSuperseded(client, findingId) {
  const { rows } = await client.query(
    `SELECT fra.id, fra.status
       FROM fra_significant_findings sf
       JOIN fire_risk_assessments fra ON fra.id = sf.fire_risk_assessment_id
      WHERE sf.id = $1`,
    [findingId],
  );
  if (rows.length === 0) throw notFound(`Significant finding ${findingId} was not found`);
  if (rows[0].status === "superseded") {
    throw conflict(
      "The assessment this measure belongs to has been superseded, so its record is closed.",
    );
  }
}

// fallow-ignore-next-line complexity
function assertMeasureCoherent(body, before) {
  const status = resulting(body, before, "status");
  const completedOn = resulting(body, before, "completed_on");
  const targetDate = resulting(body, before, "target_date");

  notInFuture(completedOn, "completed_on");

  if (status === "taken" && !present(completedOn)) {
    throw ruleViolation("A measure recorded as taken must have completed_on set");
  }
  if (status === "planned" && present(completedOn)) {
    throw ruleViolation(
      "A measure with completed_on set has been taken. Change status to 'taken', or clear completed_on.",
    );
  }
  if (status === "planned" && !present(targetDate)) {
    throw ruleViolation(
      "A planned measure must have a target_date, so that it can be seen to be outstanding",
    );
  }
}

const PERSON_CATEGORIES = [
  "disabled",
  "mobility_impaired",
  "sensory_impaired",
  "young_person",
  "lone_worker",
  "visitor",
  "contractor",
  "sleeping_occupant",
  "expectant_mother",
  "other",
];

const personAtRiskFields = {
  fire_risk_assessment_id: id,
  person_id: optionalId,
  group_description: optionalText(300),
  category: z.enum(PERSON_CATEGORIES).optional().nullable(),
  why_at_risk: optionalText(1000),
  measures: optionalText(1000),
  peep_in_place: flag.optional(),
  peep_reference: optionalText(100),
};

export const personsAtRisk = {
  name: "fra_persons_at_risk",
  label: "Person at particular risk",
  table: "fra_persons_at_risk",
  path: "/fra-persons-at-risk",
  scope: throughTable({
    table: "fire_risk_assessments",
    key: "fire_risk_assessment_id",
    alias: "fra",
    missing: "The fire risk assessment was not found",
  }),
  extraJoins: "LEFT JOIN people ppl ON ppl.id = t.person_id",
  computed: ["ppl.full_name AS person_name"],
  sortable: { id: "t.id", category: "t.category" },
  defaultSort: "id",
  search: ["t.group_description", "t.why_at_risk"],
  filters: [
    {
      param: "fire_risk_assessment_id",
      column: "t.fire_risk_assessment_id",
      schema: id.optional(),
    },
    { param: "premises_id", column: "fra.premises_id", schema: id.optional() },
    { param: "category", column: "t.category", schema: z.enum(PERSON_CATEGORIES).optional() },
    { param: "peep_in_place", column: "t.peep_in_place", schema: booleanParam() },
  ],
  schemas: {
    create: z
      .strictObject(personAtRiskFields)
      // The table requires one or the other; saying so here gives a better
      // message than the check constraint would.
      .refine(
        (value) => present(value.person_id) || present(value.group_description),
        "Give either person_id for a named individual, or group_description for a group",
      ),
    update: z.strictObject(partial(omit(personAtRiskFields, ["fire_risk_assessment_id"]))),
  },
  rules: {
    async beforeCreate(body, { client }) {
      await assertParentDraft(client, body.fire_risk_assessment_id, "the people at particular risk");
      assertPeepCoherent(body, null);
      return body;
    },
    async beforeUpdate(body, before, { client }) {
      await assertParentDraft(
        client,
        before.fire_risk_assessment_id,
        "the people at particular risk",
      );
      assertPeepCoherent(body, before);
      return body;
    },
    async beforeDelete(before, { client }) {
      await assertParentDraft(
        client,
        before.fire_risk_assessment_id,
        "the people at particular risk",
      );
    },
  },
};

function assertPeepCoherent(body, before) {
  const category = resulting(body, before, "category");
  const whyAtRisk = resulting(body, before, "why_at_risk");
  const peep = resulting(body, before, "peep_in_place");
  const peepReference = resulting(body, before, "peep_reference");

  // Reg 9(1)(b) records the groups especially at risk. A record naming a
  // category without saying why the person is at risk records the label, not
  // the finding.
  if (present(category) && !present(whyAtRisk)) {
    throw ruleViolation(
      "why_at_risk must say why this person or group is especially at risk, which is what reg 9(1)(b) records",
    );
  }
  if (peep && !present(peepReference)) {
    throw ruleViolation(
      "peep_reference must identify the personal emergency evacuation plan when peep_in_place is set",
    );
  }
}

// --- fire safety arrangements (reg 10) -------------------------------------

const arrangementFields = {
  premises_id: id,
  schedule2_measure_code: requiredText(10),
  planning: optionalText(2000),
  organisation: optionalText(2000),
  control: optionalText(2000),
  monitoring: optionalText(2000),
  review: optionalText(2000),
  responsible_person_id: optionalId,
  effective_from: isoDate.optional().nullable(),
  recorded_on: isoDate.optional().nullable(),
};

export const arrangements = {
  name: "fire_safety_arrangements",
  label: "Fire safety arrangement",
  table: "fire_safety_arrangements",
  path: "/fire-safety-arrangements",
  scope: ownPremises,
  timestamps: true,
  extraJoins: "LEFT JOIN schedule2_measures m ON m.code = t.schedule2_measure_code",
  computed: ["m.description AS measure_description", "(t.superseded_by_id IS NULL) AS is_current"],
  sortable: {
    id: "t.id",
    effective_from: "t.effective_from",
    schedule2_measure_code: "t.schedule2_measure_code",
  },
  defaultSort: "effective_from",
  search: ["t.planning", "t.organisation", "t.control", "t.monitoring", "t.review"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    {
      param: "schedule2_measure_code",
      column: "t.schedule2_measure_code",
      schema: z.string().max(10).optional(),
    },
  ],
  schemas: {
    create: z.strictObject(arrangementFields),
    update: z.strictObject(partial(omit(arrangementFields, ["premises_id"]))),
  },
  rules: {
    // Reg 10(1) requires arrangements for the planning, organisation, control,
    // monitoring and review of the fire safety measures. All five are named in
    // the regulation, so an arrangement that fills in none of them records
    // nothing.
    async beforeCreate(body, { client, premisesId }) {
      assertArrangementSubstance(body, null);
      if (await recordingDutyApplies(client, premisesId)) {
        body.recorded_on = body.recorded_on ?? today();
      }
      // Only one arrangement is in force per measure at a time. The rows that
      // will be superseded are locked here, before the insert, so a concurrent
      // create cannot leave two current arrangements for the same measure.
      await client.query(
        `SELECT id FROM fire_safety_arrangements
          WHERE premises_id = $1 AND schedule2_measure_code = $2 AND superseded_by_id IS NULL
          FOR UPDATE`,
        [premisesId, body.schedule2_measure_code],
      );
      return body;
    },

    // Superseding happens after the insert because the new row's id is what
    // the old ones point at. Keeping the previous version rather than
    // overwriting it is what makes the history readable.
    async afterCreate(created, { client, premisesId }) {
      const { rows } = await client.query(
        `SELECT id FROM fire_safety_arrangements
          WHERE premises_id = $1
            AND schedule2_measure_code = $2
            AND superseded_by_id IS NULL
            AND id <> $3
          ORDER BY id`,
        [premisesId, created.schedule2_measure_code, created.id],
      );
      for (const row of rows) {
        await client.query(
          "UPDATE fire_safety_arrangements SET superseded_by_id = $2, updated_at = now() WHERE id = $1",
          [row.id, created.id],
        );
      }
    },

    beforeUpdate(body, before) {
      if (before.superseded_by_id !== null) {
        throw conflict(
          "This arrangement has been superseded and is kept as the historical record. Amend the current one instead.",
        );
      }
      assertArrangementSubstance(body, before);
      return body;
    },

    beforeDelete(before) {
      if (before.superseded_by_id !== null) {
        throw conflict("A superseded arrangement is the historical record and is kept.");
      }
    },
  },
};

function assertArrangementSubstance(body, before) {
  const filled = ["planning", "organisation", "control", "monitoring", "review"].filter((field) =>
    present(resulting(body, before, field)),
  );
  if (filled.length === 0) {
    throw ruleViolation(
      "Reg 10(1) requires arrangements for the planning, organisation, control, monitoring and review of the measures. Fill in at least one of planning, organisation, control, monitoring or review.",
    );
  }
}

// --- dangerous substances (regs 6-7, DSEAR) --------------------------------

const substanceFields = {
  premises_id: id,
  fire_risk_assessment_id: optionalId,
  name: requiredText(200),
  quantity: optionalText(100),
  location: optionalText(300),
  hazardous_properties: optionalText(1000),
  supplier_safety_data_ref: optionalText(200),
  ignition_sources: optionalText(1000),
  explosive_atmosphere_likely: flag.optional(),
  explosive_atmosphere_notes: optionalText(1000),
  hazardous_area_classification: optionalText(200),
  area_marked: flag.optional(),
  assessed_on: isoDate.optional().nullable(),
  assessed_by_id: optionalId,
};

export const dangerousSubstances = {
  name: "dangerous_substances",
  label: "Dangerous substance",
  table: "dangerous_substances",
  path: "/dangerous-substances",
  scope: ownPremises,
  timestamps: true,
  sortable: { id: "t.id", name: "t.name", assessed_on: "t.assessed_on" },
  defaultSort: "name",
  search: ["t.name", "t.location", "t.hazardous_properties"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    {
      param: "explosive_atmosphere_likely",
      column: "t.explosive_atmosphere_likely",
      schema: booleanParam(),
    },
  ],
  schemas: {
    create: z.strictObject(substanceFields),
    update: z.strictObject(partial(omit(substanceFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      assertSubstanceCoherent(body, null);
      return body;
    },
    beforeUpdate(body, before) {
      assertSubstanceCoherent(body, before);
      return body;
    },
  },
};

function assertSubstanceCoherent(body, before) {
  notInFuture(resulting(body, before, "assessed_on"), "assessed_on");

  const explosive = resulting(body, before, "explosive_atmosphere_likely");
  if (!explosive) return;

  // DSEAR reg 7 and sch.2: where an explosive atmosphere may occur, the place
  // is classified into zones and the entry points to classified places are
  // marked. Recording the likelihood without the classification leaves the
  // record short of what reg 7 asks for.
  if (!present(resulting(body, before, "hazardous_area_classification"))) {
    throw ruleViolation(
      "Where an explosive atmosphere is likely, hazardous_area_classification must record the zone (DSEAR 2002 reg 7 and sch.2)",
    );
  }
  if (!present(resulting(body, before, "explosive_atmosphere_notes"))) {
    throw ruleViolation(
      "explosive_atmosphere_notes must describe the circumstances in which the explosive atmosphere may occur",
    );
  }
}
