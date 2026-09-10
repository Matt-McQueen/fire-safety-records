// Emergency procedures, drills, training, information and cooperation, and the
// written health and safety policy.
//
// SSI 2006/456 reg 14 requires procedures for serious and imminent danger,
// reg 18 cooperation and coordination where more than one duty holder is
// involved, reg 20 training, and reg 21 information to employees. HSWA 1974
// s.2(3) requires the written policy where five or more people are employed.

import { z } from "zod";
import {
  flag,
  id,
  isoDate,
  isoDateTime,
  omit,
  optionalId,
  optionalText,
  partial,
  requiredText,
} from "../../http/validate.js";
import { conflict, ruleViolation } from "../../http/errors.js";
import { optionalPremises, ownPremises } from "../scope.js";
import {
  addDays,
  countRows,
  findSchedule,
  notInFuture,
  present,
  resulting,
  today,
} from "../rules.js";

// --- versioned documents ---------------------------------------------------
//
// Procedures and policies are replaced rather than edited: the version in force
// last year is what the premises was operating under last year, and an
// inspection may ask about it. Creating a new one supersedes the previous
// version and increments the version number; the old row stays.

function versionedDocument({ name, label, table, path, fields, scope, describe, search, extraRules }) {
  return {
    name,
    label,
    table,
    path,
    scope,
    permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
    computed: ["(t.superseded_by_id IS NULL) AS is_current"],
    sortable: { id: "t.id", version: "t.version", effective_from: "t.effective_from" },
    defaultSort: "effective_from",
    filters: [
      { param: "premises_id", column: "t.premises_id", schema: id.optional() },
      { param: "version", column: "t.version", schema: z.coerce.number().int().optional() },
    ],
    search,
    schemas: {
      create: z.strictObject(fields),
      update: z.strictObject(partial(omit(fields, ["premises_id"]))),
    },
    rules: {
      async beforeCreate(body, { client, premisesId }) {
        // Locked before the insert so two concurrent creates cannot both
        // conclude they are version 2.
        const { rows } = await client.query(
          `SELECT id, version FROM ${table}
            WHERE premises_id IS NOT DISTINCT FROM $1
            ORDER BY version DESC
            FOR UPDATE`,
          [premisesId],
        );
        return {
          ...body,
          version: (rows[0]?.version ?? 0) + 1,
          effective_from: body.effective_from ?? today(),
        };
      },

      async afterCreate(created, { client, premisesId }) {
        await client.query(
          `UPDATE ${table} SET superseded_by_id = $2
            WHERE premises_id IS NOT DISTINCT FROM $1
              AND superseded_by_id IS NULL
              AND id <> $2`,
          [premisesId, created.id],
        );
      },

      beforeUpdate(body, before) {
        if (before.superseded_by_id !== null) {
          throw conflict(
            `This ${describe} has been superseded and is kept as the record of what was in force at the time. Create a new version instead.`,
          );
        }
        return body;
      },

      beforeDelete(before) {
        if (before.superseded_by_id !== null) {
          throw conflict(
            `A superseded ${describe} is the record of what was in force at the time and is kept.`,
          );
        }
      },

      ...extraRules,
    },
  };
}

// --- emergency procedures (reg 14) -----------------------------------------

export const emergencyProcedures = versionedDocument({
  name: "emergency_procedures",
  label: "Emergency procedure",
  table: "emergency_procedures",
  path: "/emergency-procedures",
  scope: ownPremises,
  describe: "procedure",
  search: ["t.title", "t.procedure"],
  fields: {
    premises_id: id,
    title: requiredText(200),
    procedure: requiredText(20000),
    effective_from: isoDate.optional().nullable(),
  },
});

// --- fire drills -----------------------------------------------------------

const drillFields = {
  premises_id: id,
  held_at: isoDateTime,
  scenario: optionalText(1000),
  evacuation_time_seconds: z.coerce.number().int().min(1).max(7200).optional().nullable(),
  persons_participating: z.coerce.number().int().min(0).optional().nullable(),
  wardens_present: optionalText(500),
  issues_identified: optionalText(2000),
  actions_taken: optionalText(2000),
  conducted_by_id: optionalId,
};

export const fireDrills = {
  name: "fire_drills",
  label: "Fire drill",
  table: "fire_drills",
  path: "/fire-drills",
  scope: ownPremises,
  extraJoins: "LEFT JOIN people ppl ON ppl.id = t.conducted_by_id",
  computed: ["ppl.full_name AS conducted_by_name"],
  sortable: { id: "t.id", held_at: "t.held_at" },
  defaultSort: "held_at",
  search: ["t.scenario", "t.issues_identified", "t.actions_taken"],
  filters: [{ param: "premises_id", column: "t.premises_id", schema: id.optional() }],
  dateRanges: [{ param: "held_at", column: "t.held_at", schema: isoDateTime.optional() }],
  schemas: {
    create: z.strictObject(drillFields),
    update: z.strictObject(partial(omit(drillFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      assertDrillCoherent(body, null);
      return body;
    },
    beforeUpdate(body, before) {
      assertDrillCoherent(body, before);
      return body;
    },
  },
};

function assertDrillCoherent(body, before) {
  const heldAt = resulting(body, before, "held_at");
  if (heldAt && new Date(heldAt) > new Date()) {
    throw ruleViolation("held_at cannot be in the future");
  }

  // Reg 14(1) requires the procedures to be effective, and a drill is how that
  // is tested. A drill that found problems and records nothing done about them
  // is evidence of the problem, not of the duty being discharged.
  const issues = resulting(body, before, "issues_identified");
  const actions = resulting(body, before, "actions_taken");
  if (present(issues) && !present(actions)) {
    throw ruleViolation(
      "actions_taken must record what was done about the issues the drill identified",
    );
  }
}

// --- training (reg 20) -----------------------------------------------------

const TRAINING_TYPES = [
  "induction",
  "new_or_changed_risk",
  "refresher",
  "fire_warden",
  "extinguisher_use",
  "evacuation_aid",
  "other",
];

const trainingFields = {
  premises_id: id,
  person_id: id,
  training_type: z.enum(TRAINING_TYPES),
  delivered_on: isoDate,
  delivered_by_id: optionalId,
  provider: optionalText(200),
  content_summary: optionalText(2000),
  during_working_hours: flag.optional().nullable(),
  next_due_on: isoDate.optional().nullable(),
};

export const trainingRecords = {
  name: "training_records",
  label: "Training record",
  table: "training_records",
  path: "/training-records",
  scope: ownPremises,
  extraJoins: "JOIN people ppl ON ppl.id = t.person_id",
  computed: [
    "ppl.full_name AS person_name",
    "(t.next_due_on IS NOT NULL AND t.next_due_on < current_date) AS refresher_overdue",
  ],
  sortable: {
    id: "t.id",
    delivered_on: "t.delivered_on",
    next_due_on: "t.next_due_on",
    person_name: "ppl.full_name",
  },
  defaultSort: "delivered_on",
  search: ["t.provider", "t.content_summary", "ppl.full_name"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    { param: "person_id", column: "t.person_id", schema: id.optional() },
    {
      param: "training_type",
      column: "t.training_type",
      schema: z.enum(TRAINING_TYPES).optional(),
    },
  ],
  dateRanges: [
    { param: "delivered_on", column: "t.delivered_on", schema: isoDate.optional() },
    { param: "next_due_on", column: "t.next_due_on", schema: isoDate.optional() },
  ],
  schemas: {
    create: z.strictObject(trainingFields),
    update: z.strictObject(partial(omit(trainingFields, ["premises_id", "person_id"]))),
  },
  rules: {
    async beforeCreate(body, { client, premisesId }) {
      assertTrainingCoherent(body, null);

      // Reg 20(2)(a) requires training to be repeated periodically where
      // appropriate. How often is not in the regulations, so the interval comes
      // from check_schedules like every other interval here.
      if (!present(body.next_due_on)) {
        const schedule = await findSchedule(client, {
          premisesId,
          appliesTo: `training:${body.training_type}`,
          checkType: "training",
        });
        if (schedule) body.next_due_on = addDays(body.delivered_on, schedule.interval_days);
      }
      return body;
    },
    beforeUpdate(body, before) {
      assertTrainingCoherent(body, before);
      return body;
    },
  },
};

function assertTrainingCoherent(body, before) {
  const deliveredOn = resulting(body, before, "delivered_on");
  notInFuture(deliveredOn, "delivered_on");

  const nextDue = resulting(body, before, "next_due_on");
  if (present(nextDue) && present(deliveredOn) && nextDue < deliveredOn) {
    throw ruleViolation("next_due_on cannot be before delivered_on");
  }

  // Reg 20(4): the training must take place during working hours. Recording
  // that it did not is allowed — the record should say what happened — but the
  // departure has to be explained rather than left as a bare flag.
  if (resulting(body, before, "during_working_hours") === false) {
    if (!present(resulting(body, before, "content_summary"))) {
      throw ruleViolation(
        "Reg 20(4) requires training to take place during working hours. If it did not, content_summary must explain the circumstances.",
      );
    }
  }
}

// --- information to employees (reg 21) -------------------------------------

const INFORMATION_TYPES = [
  "risks_identified",
  "preventive_measures",
  "nominated_person_identities",
  "dangerous_substances",
  "emergency_procedures",
  "other",
];

const informationFields = {
  premises_id: id,
  person_id: optionalId,
  group_description: optionalText(300),
  information_type: z.enum(INFORMATION_TYPES),
  provided_on: isoDate,
  method: optionalText(200),
  provided_by_id: optionalId,
  notes: optionalText(2000),
};

export const informationRecords = {
  name: "employee_information_records",
  label: "Information record",
  table: "employee_information_records",
  path: "/employee-information-records",
  scope: ownPremises,
  extraJoins: "LEFT JOIN people ppl ON ppl.id = t.person_id",
  computed: ["ppl.full_name AS person_name"],
  sortable: { id: "t.id", provided_on: "t.provided_on" },
  defaultSort: "provided_on",
  search: ["t.group_description", "t.method", "t.notes"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    { param: "person_id", column: "t.person_id", schema: id.optional() },
    {
      param: "information_type",
      column: "t.information_type",
      schema: z.enum(INFORMATION_TYPES).optional(),
    },
  ],
  dateRanges: [{ param: "provided_on", column: "t.provided_on", schema: isoDate.optional() }],
  schemas: {
    create: z
      .strictObject(informationFields)
      .refine(
        (value) => present(value.person_id) || present(value.group_description),
        "Give either person_id for one employee, or group_description for a group",
      ),
    update: z.strictObject(partial(omit(informationFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      notInFuture(body.provided_on, "provided_on");
      return body;
    },
    beforeUpdate(body, before) {
      notInFuture(resulting(body, before, "provided_on"), "provided_on");
      return body;
    },
  },
};

// --- cooperation (reg 18) --------------------------------------------------

const cooperationFields = {
  premises_id: id,
  other_duty_holder: requiredText(200),
  contact_details: optionalText(500),
  arrangements: optionalText(2000),
  information_shared: optionalText(2000),
  recorded_on: isoDate.optional().nullable(),
};

export const cooperationRecords = {
  name: "cooperation_records",
  label: "Cooperation record",
  table: "cooperation_records",
  path: "/cooperation-records",
  scope: ownPremises,
  sortable: { id: "t.id", recorded_on: "t.recorded_on" },
  defaultSort: "recorded_on",
  search: ["t.other_duty_holder", "t.arrangements", "t.information_shared"],
  filters: [{ param: "premises_id", column: "t.premises_id", schema: id.optional() }],
  schemas: {
    create: z.strictObject(cooperationFields),
    update: z.strictObject(partial(omit(cooperationFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      assertCooperationSubstance(body, null);
      return { ...body, recorded_on: body.recorded_on ?? today() };
    },
    beforeUpdate(body, before) {
      assertCooperationSubstance(body, before);
      return body;
    },
  },
};

function assertCooperationSubstance(body, before) {
  notInFuture(resulting(body, before, "recorded_on"), "recorded_on");
  // Reg 18 requires cooperation and coordination, and the sharing of
  // information on the risks. Naming the other duty holder without saying what
  // was arranged or shared records the relationship, not the duty.
  if (
    !present(resulting(body, before, "arrangements")) &&
    !present(resulting(body, before, "information_shared"))
  ) {
    throw ruleViolation(
      "Record what was coordinated in arrangements, or what was passed on in information_shared (SSI 2006/456 reg 18)",
    );
  }
}

// --- written health and safety policy (HSWA 1974 s.2(3)) -------------------

export const healthSafetyPolicies = versionedDocument({
  name: "health_safety_policies",
  label: "Health and safety policy",
  table: "health_safety_policies",
  path: "/health-safety-policies",
  // A policy may be written once for the organisation (premises_id NULL) or
  // separately for each premises.
  scope: optionalPremises,
  describe: "policy",
  search: ["t.statement"],
  fields: {
    premises_id: optionalId,
    statement: requiredText(50000),
    effective_from: isoDate.optional().nullable(),
  },
  extraRules: {
    // s.2(3): the duty to prepare and revise a written policy applies unless
    // fewer than five people are employed. Deleting the only policy for a
    // premises that employs five or more would leave the duty unevidenced.
    async beforeDelete(before, { client }) {
      if (before.superseded_by_id !== null) {
        throw conflict(
          "A superseded policy is the record of what was in force at the time and is kept.",
        );
      }
      if (before.premises_id === null) return;

      const employees = await countRows(
        client,
        "SELECT COALESCE(employee_count, 0) AS count FROM premises WHERE id = $1",
        [before.premises_id],
      );
      if (employees >= 5) {
        throw conflict(
          `This premises employs ${employees} people, so HSWA 1974 s.2(3) requires a written policy. Replace it with a new version rather than deleting it.`,
        );
      }
    },
  },
});

export { TRAINING_TYPES, INFORMATION_TYPES };
