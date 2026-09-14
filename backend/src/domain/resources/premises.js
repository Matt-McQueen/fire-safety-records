// Premises, people and the safety roles that connect them.

import { z } from "zod";
import {
  booleanParam,
  count,
  flag,
  id,
  isoDate,
  omit,
  optionalPostcode,
  optionalText,
  partial,
  requiredText,
} from "../../http/validate.js";
import { idParam, validateParams } from "../../http/validate.js";
import { conflict, ruleViolation } from "../../http/errors.js";
import { asyncHandler } from "../../http/asyncHandler.js";
import { requireRole } from "../../auth/middleware.js";
import { complianceForPremises } from "../compliance.js";
import { noPremises, ownPremises, selfPremises } from "../scope.js";
import {
  countRows,
  loadRow,
  notBefore,
  notInFuture,
  present,
  resulting,
} from "../rules.js";

// Fire (Scotland) Act 2005 s.61: the Scottish Fire and Rescue Service enforces
// in relevant premises, except that the Health and Safety Executive enforces on
// construction sites and on ships under construction or repair.
const ENFORCING_AUTHORITIES = [
  "Scottish Fire and Rescue Service",
  "Health and Safety Executive",
];

// --- premises --------------------------------------------------------------

const premisesFields = {
  name: requiredText(200),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  town: optionalText(100),
  postcode: optionalPostcode,
  duty_holder_name: optionalText(200),
  duty_holder_role: optionalText(200),
  employee_count: count.optional().nullable(),
  requires_licence: flag.optional(),
  licence_details: optionalText(500),
  enforcing_authority: z.enum(ENFORCING_AUTHORITIES).optional(),
  is_multi_occupancy: flag.optional(),
  notes: optionalText(),
};

export const premises = {
  name: "premises",
  label: "Premises",
  table: "premises",
  path: "/premises",
  scope: selfPremises,
  timestamps: true,
  // Whether the duty to record applies is computed by the database view, not
  // by the client. It depends on employee count, licensing and whether an
  // alterations notice is in force, and the answer changes as those change.
  extraJoins: "LEFT JOIN premises_recording_duty d ON d.premises_id = t.id",
  computed: [
    "d.recording_duty_applies",
    "d.trigger_five_or_more_employees",
    "d.trigger_licensed_premises",
    "d.trigger_alterations_notice",
  ],
  // Creating and amending a premises is a manager's job; only an admin may
  // remove one, because deleting it would cascade through every record held
  // against it.
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "admin" },
  sortable: { id: "t.id", name: "t.name", town: "t.town", created_at: "t.created_at" },
  defaultSort: "name",
  search: ["t.name", "t.town", "t.postcode", "t.address_line1"],
  filters: [
    { param: "town", column: "t.town", schema: z.string().trim().max(100).optional() },
    { param: "requires_licence", column: "t.requires_licence", schema: booleanParam() },
    { param: "is_multi_occupancy", column: "t.is_multi_occupancy", schema: booleanParam() },
  ],
  schemas: {
    create: z.strictObject(premisesFields),
    update: z.strictObject(partial(premisesFields)),
  },
  rules: {
    beforeCreate(body) {
      assertLicenceDetails(body, null);
      return body;
    },
    // A manager who creates a premises would otherwise be unable to see it,
    // because their access comes from user_premises and nothing has granted it.
    async afterCreate(created, { user, client }) {
      if (user.role === "admin") return;
      await client.query(
        `INSERT INTO user_premises (user_id, premises_id, granted_by)
         VALUES ($1, $2, $1) ON CONFLICT DO NOTHING`,
        [user.id, created.id],
      );
    },
    beforeUpdate(body, before) {
      assertLicenceDetails(body, before);
      return body;
    },
    // Deleting a premises cascades into every assessment, check, drill and
    // incident recorded against it. Those are the evidence that statutory
    // duties were discharged, so the delete is refused while any of them exist
    // and the caller is told what stands in the way.
    async beforeDelete(before, { client }) {
      const blockers = [];
      for (const [label, table] of [
        ["fire risk assessments", "fire_risk_assessments"],
        ["incidents", "incidents"],
        ["enforcement notices", "enforcement_notices"],
        ["equipment records", "equipment"],
        ["training records", "training_records"],
      ]) {
        const total = await countRows(
          client,
          `SELECT count(*) FROM ${table} WHERE premises_id = $1`,
          [before.id],
        );
        if (total > 0) blockers.push(`${total} ${label}`);
      }
      if (blockers.length > 0) {
        throw conflict(
          `This premises still holds ${blockers.join(", ")}. Records kept against a statutory duty cannot be removed by deleting the premises.`,
          { blockers },
        );
      }
    },
  },

  extend(router, { permissions }) {
    // The compliance position for one premises: which records the legislation
    // expects are present, which are overdue and which are missing. Every
    // judgement in it is made here rather than by whatever is displaying it.
    router.get(
      "/:id/compliance",
      requireRole(permissions.read),
      validateParams(idParam),
      asyncHandler(async (req, res) => {
        res.json({ data: await complianceForPremises(req.validatedParams.id, req.user) });
      }),
    );
  },
};

function assertLicenceDetails(body, before) {
  const requiresLicence = resulting(body, before, "requires_licence");
  const details = resulting(body, before, "licence_details");
  if (requiresLicence && !present(details)) {
    // The licence is one of the three triggers for the duty to record, so what
    // the licence is has to be on the record, not just the fact of one.
    throw ruleViolation(
      "licence_details must say which licence or registration the premises needs, because that is what triggers the duty to record",
    );
  }
}

// --- people ----------------------------------------------------------------

const peopleFields = {
  full_name: requiredText(200),
  job_title: optionalText(150),
  email: optionalText(320).refine(
    (value) => value === null || value === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Must be an email address",
  ),
  phone: optionalText(50),
  is_employee: flag.optional(),
  started_on: isoDate.optional().nullable(),
  ended_on: isoDate.optional().nullable(),
  notes: optionalText(),
};

export const people = {
  name: "people",
  label: "Person",
  table: "people",
  path: "/people",
  // A person is not owned by one premises — staff move between sites, and an
  // external assessor may work across several. So access is by connection:
  // a manager or admin sees the whole directory, and everyone else sees only
  // the people connected to a premises they are assigned to.
  scope: {
    joins: "",
    premisesExpr: "NULL::integer",
    parent: null,
    accessClause({ premisesParam, user }) {
      if (user.role === "manager") return null;
      const premises = premisesParam();
      return `EXISTS (
        SELECT 1 FROM safety_roles r
         WHERE r.person_id = t.id AND r.premises_id = ANY(${premises})
        UNION ALL
        SELECT 1 FROM training_records tr
         WHERE tr.person_id = t.id AND tr.premises_id = ANY(${premises})
        UNION ALL
        SELECT 1 FROM fra_persons_at_risk pr
         JOIN fire_risk_assessments fra ON fra.id = pr.fire_risk_assessment_id
         WHERE pr.person_id = t.id AND fra.premises_id = ANY(${premises})
      )`;
    },
  },
  timestamps: true,
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  sortable: { id: "t.id", full_name: "t.full_name", started_on: "t.started_on" },
  defaultSort: "full_name",
  search: ["t.full_name", "t.job_title", "t.email"],
  filters: [{ param: "is_employee", column: "t.is_employee", schema: booleanParam() }],
  schemas: {
    create: z.strictObject(peopleFields),
    update: z.strictObject(partial(peopleFields)),
  },
  rules: {
    beforeCreate(body) {
      notBefore(body.ended_on, body.started_on, "ended_on", "started_on");
      return body;
    },
    beforeUpdate(body, before) {
      notBefore(
        resulting(body, before, "ended_on"),
        resulting(body, before, "started_on"),
        "ended_on",
        "started_on",
      );
      return body;
    },
    // Training records and entries in an assessment's persons-at-risk list are
    // deleted with the person by the schema's cascades. Those records are the
    // evidence that people were trained and that particular risks were
    // considered, so a person who appears in them is closed rather than
    // deleted: set ended_on instead.
    async beforeDelete(before, { client }) {
      const links = [];
      for (const [label, sql] of [
        ["training records", "SELECT count(*) FROM training_records WHERE person_id = $1"],
        ["safety roles", "SELECT count(*) FROM safety_roles WHERE person_id = $1"],
        [
          "entries as a person at particular risk",
          "SELECT count(*) FROM fra_persons_at_risk WHERE person_id = $1",
        ],
        [
          "recorded checks",
          "SELECT count(*) FROM equipment_checks WHERE performed_by_id = $1",
        ],
        [
          "fire risk assessments carried out",
          "SELECT count(*) FROM fire_risk_assessments WHERE carried_out_by_id = $1",
        ],
      ]) {
        const total = await countRows(client, sql, [before.id]);
        if (total > 0) links.push(`${total} ${label}`);
      }
      if (links.length > 0) {
        throw conflict(
          `This person appears in ${links.join(", ")}. Set ended_on to close the record instead of deleting it, so the evidence those records provide is kept.`,
          { links },
        );
      }
    },
  },
};

// --- safety roles ----------------------------------------------------------

const ROLES = [
  "nominated_firefighting",
  "competent_assistance",
  "fire_warden",
  "duty_holder",
  "other",
];

const safetyRoleFields = {
  premises_id: id,
  person_id: id,
  role: z.enum(ROLES),
  appointed_on: isoDate.optional().nullable(),
  ended_on: isoDate.optional().nullable(),
  competence_evidence: optionalText(1000),
  legal_basis_code: optionalText(50),
};

export const safetyRoles = {
  name: "safety_roles",
  label: "Safety role",
  table: "safety_roles",
  path: "/safety-roles",
  scope: ownPremises,
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  sortable: { id: "t.id", appointed_on: "t.appointed_on", role: "t.role" },
  defaultSort: "appointed_on",
  extraJoins: "JOIN people ppl ON ppl.id = t.person_id JOIN premises prem ON prem.id = t.premises_id",
  computed: ["ppl.full_name AS person_name", "prem.name AS premises_name", "(t.ended_on IS NULL) AS is_active"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    { param: "person_id", column: "t.person_id", schema: id.optional() },
    { param: "role", column: "t.role", schema: z.enum(ROLES).optional() },
  ],
  schemas: {
    create: z.strictObject(safetyRoleFields),
    update: z.strictObject(partial(omit(safetyRoleFields, ["premises_id", "person_id"]))),
  },
  rules: {
    async beforeCreate(body, { client, premisesId }) {
      await assertRoleCoherent(client, body, null, premisesId);
      return body;
    },
    async beforeUpdate(body, before, { client, premisesId }) {
      await assertRoleCoherent(client, body, before, premisesId);
      return body;
    },
  },
};

async function assertRoleCoherent(client, body, before, premisesId) {
  const role = resulting(body, before, "role");
  const personId = before?.person_id ?? body.person_id;
  const appointedOn = resulting(body, before, "appointed_on");
  const endedOn = resulting(body, before, "ended_on");

  notInFuture(appointedOn, "appointed_on");
  notBefore(endedOn, appointedOn, "ended_on", "appointed_on");

  const person = await loadRow(client, "people", personId, "Person");

  assertNominatedRoleIsEmployee(role, person);
  assertCompetenceRecorded(role, resulting(body, before, "competence_evidence"));
  await assertNoDutyHolderClash(client, role, endedOn, premisesId, before?.id ?? 0);
  await assertNoDuplicateActiveRole(client, personId, role, endedOn, premisesId, before?.id ?? 0);
}

// Fire (Scotland) Act 2005 s.53(4) and SSI 2006/456 reg 15: the people
// nominated to implement firefighting measures, and those given evacuation
// duties, are employees. An outside contractor can advise but cannot be the
// nominated person.
function assertNominatedRoleIsEmployee(role, person) {
  if (!["nominated_firefighting", "fire_warden"].includes(role) || person.is_employee) return;
  throw ruleViolation(
    `A ${role.replace(/_/g, " ")} must be an employee. Record an external adviser as competent_assistance instead.`,
  );
}

// s.53(1) and reg 15 both turn on competence, so the record has to say what
// the competence rests on rather than merely asserting it.
function assertCompetenceRecorded(role, competenceEvidence) {
  if (!["nominated_firefighting", "competent_assistance"].includes(role) || present(competenceEvidence)) return;
  throw ruleViolation(
    "competence_evidence must record the training, experience or qualification the appointment relies on",
  );
}

// s.54: one person has control of the premises. Two people simultaneously
// holding it makes the record useless as evidence of who the duty holder is.
async function assertNoDutyHolderClash(client, role, endedOn, premisesId, excludeId) {
  if (role !== "duty_holder" || present(endedOn)) return;
  const clash = await countRows(
    client,
    `SELECT count(*) FROM safety_roles
      WHERE premises_id = $1 AND role = 'duty_holder' AND ended_on IS NULL AND id <> $2`,
    [premisesId, excludeId],
  );
  if (clash > 0) {
    throw conflict(
      "This premises already has a duty holder. End the current appointment before recording a new one.",
    );
  }
}

// Appointing the same person to the same role at the same premises twice
// over, while both remain active, is never meaningful — it is duplication,
// not a second appointment. A reappointment after one has ended is fine and
// is not affected by this check.
async function assertNoDuplicateActiveRole(client, personId, role, endedOn, premisesId, excludeId) {
  if (present(endedOn)) return;
  const duplicate = await countRows(
    client,
    `SELECT count(*) FROM safety_roles
      WHERE premises_id = $1 AND person_id = $2 AND role = $3 AND ended_on IS NULL AND id <> $4`,
    [premisesId, personId, role, excludeId],
  );
  if (duplicate > 0) {
    throw conflict("This person already holds this role at this premises. End the current appointment first.");
  }
}

// --- reference data --------------------------------------------------------

// The catalogue of statutory duties and the Schedule 2 measures. These describe
// the legislation rather than any premises, so they are readable by anyone
// signed in and changeable only by an admin — they change when the law does.

export const legalBasis = {
  name: "legal_basis",
  label: "Legal basis",
  table: "legal_basis",
  path: "/legal-basis",
  scope: noPremises,
  idColumn: "code",
  permissions: { read: "viewer", create: "admin", update: "admin", remove: "admin" },
  operations: ["list"],
  sortable: { code: "t.code", instrument: "t.instrument" },
  defaultSort: "code",
  search: ["t.code", "t.instrument", "t.provision", "t.duty"],
  filters: [
    { param: "is_recording_duty", column: "t.is_recording_duty", schema: booleanParam() },
  ],
  schemas: { create: z.strictObject({}), update: z.strictObject({}) },
};

export const schedule2Measures = {
  name: "schedule2_measures",
  label: "Schedule 2 measure",
  table: "schedule2_measures",
  path: "/schedule2-measures",
  scope: noPremises,
  idColumn: "code",
  permissions: { read: "viewer" },
  operations: ["list"],
  sortable: { code: "t.code" },
  defaultSort: "code",
  search: ["t.code", "t.description"],
  schemas: { create: z.strictObject({}), update: z.strictObject({}) },
};
