// Equipment, escape routes and the checks recorded against them.
//
// SSI 2006/456 regs 12, 13 and 16 require the fire safety measures to be
// maintained in efficient working order and in good repair, and the routes to
// be kept clear. Neither the regulations nor the Act set an interval for any
// test or inspection. Every interval in common use comes from Scottish
// Government guidance or a British Standard, so intervals are configuration in
// check_schedules, and the API computes the next due date from them rather
// than hard-coding a number.

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
import { conflict, forbidden, notFound, ruleViolation } from "../../http/errors.js";
import { optionalPremises, ownPremises, throughTable } from "../scope.js";
import {
  addDays,
  countRows,
  findSchedule,
  notBefore,
  notInFuture,
  present,
  resulting,
} from "../rules.js";

const EQUIPMENT_TYPES = [
  "extinguisher",
  "fire_blanket",
  "hose_reel",
  "sprinkler",
  "alarm_panel",
  "call_point",
  "detector",
  "sounder",
  "emergency_lighting",
  "fire_door",
  "signage",
  "smoke_control",
  "dry_riser",
  "other",
];

const OUTCOMES = ["pass", "fail", "pass_with_defects"];

// --- check schedules -------------------------------------------------------

const scheduleFields = {
  // Null means the schedule is the organisation-wide default, used wherever a
  // premises has not set its own.
  premises_id: optionalId,
  applies_to: requiredText(100),
  check_type: requiredText(50),
  interval_days: z.coerce.number().int().min(1).max(3650),
  recommended_by: optionalText(200),
  is_statutory: flag.optional(),
  notes: optionalText(1000),
};

export const checkSchedules = {
  name: "check_schedules",
  label: "Check schedule",
  table: "check_schedules",
  path: "/check-schedules",
  scope: optionalPremises,
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  sortable: { id: "t.id", applies_to: "t.applies_to", interval_days: "t.interval_days" },
  defaultSort: "applies_to",
  search: ["t.applies_to", "t.check_type", "t.recommended_by", "t.notes"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    { param: "applies_to", column: "t.applies_to", schema: z.string().max(100).optional() },
    { param: "check_type", column: "t.check_type", schema: z.string().max(50).optional() },
    { param: "is_statutory", column: "t.is_statutory", schema: booleanParam() },
  ],
  schemas: {
    create: z.strictObject(scheduleFields),
    update: z.strictObject(partial(omit(scheduleFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body, { user }) {
      assertScheduleHonest(body, null, user);
      return body;
    },
    beforeUpdate(body, before, { user }) {
      assertScheduleHonest(body, before, user);
      return body;
    },
  },
};

function assertScheduleHonest(body, before, user) {
  const statutory = resulting(body, before, "is_statutory");
  if (!statutory) return;

  // No test or inspection interval in this domain is set by legislation: they
  // come from Scottish Government guidance and the British Standards. Marking
  // one statutory asserts something about the law, so it needs a citation and
  // it is not an everyday edit.
  if (user.role !== "admin") {
    throw forbidden(
      "Only an admin may mark a schedule as statutory. No test or inspection interval in the Fire (Scotland) Act 2005 or SSI 2006/456 is fixed by legislation; the intervals in use come from guidance and the British Standards.",
    );
  }
  if (!present(resulting(body, before, "recommended_by"))) {
    throw ruleViolation(
      "recommended_by must cite the provision that fixes the interval when is_statutory is set",
    );
  }
}

// --- equipment -------------------------------------------------------------

const equipmentFields = {
  premises_id: id,
  equipment_type: z.enum(EQUIPMENT_TYPES),
  schedule2_measure_code: optionalText(10),
  identifier: optionalText(100),
  location: requiredText(300),
  make: optionalText(100),
  model: optionalText(100),
  serial_number: optionalText(100),
  installed_on: isoDate.optional().nullable(),
  standard_reference: optionalText(100),
  in_service: flag.optional(),
  removed_on: isoDate.optional().nullable(),
};

export const equipment = {
  name: "equipment",
  label: "Equipment",
  table: "equipment",
  path: "/equipment",
  scope: ownPremises,
  timestamps: true,
  // The state of the last check, and whether the next one is overdue, are
  // properties of the equipment that every client would otherwise have to
  // derive for itself from the check history.
  extraJoins: `LEFT JOIN LATERAL (
      SELECT c.performed_on, c.outcome, c.next_due_on, c.remedied_on, c.defects_found
        FROM equipment_checks c
       WHERE c.equipment_id = t.id
       ORDER BY c.performed_on DESC, c.id DESC
       LIMIT 1
    ) last_check ON TRUE`,
  computed: [
    "last_check.performed_on AS last_checked_on",
    "last_check.outcome AS last_check_outcome",
    "last_check.next_due_on AS next_check_due",
    `(last_check.next_due_on IS NOT NULL
      AND last_check.next_due_on < current_date
      AND t.in_service) AS check_overdue`,
    `(last_check.outcome IN ('fail', 'pass_with_defects')
      AND last_check.remedied_on IS NULL) AS has_unresolved_defect`,
  ],
  sortable: {
    id: "t.id",
    equipment_type: "t.equipment_type",
    location: "t.location",
    installed_on: "t.installed_on",
    next_check_due: "last_check.next_due_on",
  },
  defaultSort: "location",
  search: ["t.identifier", "t.location", "t.make", "t.model", "t.serial_number"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    {
      param: "equipment_type",
      column: "t.equipment_type",
      schema: z.enum(EQUIPMENT_TYPES).optional(),
    },
    { param: "in_service", column: "t.in_service", schema: booleanParam() },
    {
      param: "schedule2_measure_code",
      column: "t.schedule2_measure_code",
      schema: z.string().max(10).optional(),
    },
  ],
  schemas: {
    create: z.strictObject(equipmentFields),
    update: z.strictObject(partial(omit(equipmentFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      assertServiceStateCoherent(body, null);
      return body;
    },
    beforeUpdate(body, before) {
      assertServiceStateCoherent(body, before);
      return body;
    },
    // The check history is the evidence that reg 12 was complied with, and it
    // is deleted with the equipment by the schema's cascade. Equipment that
    // has been checked is therefore taken out of service rather than deleted.
    async beforeDelete(before, { client }) {
      const checks = await countRows(
        client,
        "SELECT count(*) FROM equipment_checks WHERE equipment_id = $1",
        [before.id],
      );
      if (checks > 0) {
        throw conflict(
          `This equipment has ${checks} recorded check(s), which evidence that it was maintained. Take it out of service instead: set in_service to false and removed_on to the date it was removed.`,
          { checks },
        );
      }
    },
  },
};

function assertServiceStateCoherent(body, before) {
  const inService = resulting(body, before, "in_service") ?? true;
  const removedOn = resulting(body, before, "removed_on");
  const installedOn = resulting(body, before, "installed_on");

  notInFuture(installedOn, "installed_on");
  notInFuture(removedOn, "removed_on");
  notBefore(removedOn, installedOn, "removed_on", "installed_on");

  if (!inService && !present(removedOn)) {
    throw ruleViolation(
      "removed_on must record when the equipment was taken out of service",
    );
  }
  if (inService && present(removedOn)) {
    throw ruleViolation(
      "Equipment with removed_on set is not in service. Clear removed_on, or set in_service to false.",
    );
  }
}

// --- equipment checks ------------------------------------------------------

const equipmentCheckFields = {
  equipment_id: id,
  check_schedule_id: optionalId,
  check_type: requiredText(50),
  performed_on: isoDate,
  performed_by_id: optionalId,
  performed_by_external: optionalText(200),
  outcome: z.enum(OUTCOMES),
  defects_found: optionalText(2000),
  remedial_action: optionalText(2000),
  remedied_on: isoDate.optional().nullable(),
  // Left out deliberately: next_due_on is computed from the schedule unless the
  // client sets it, which it may.
  next_due_on: isoDate.optional().nullable(),
  certificate_reference: optionalText(200),
};

export const equipmentChecks = {
  name: "equipment_checks",
  label: "Equipment check",
  table: "equipment_checks",
  path: "/equipment-checks",
  scope: throughTable({
    table: "equipment",
    key: "equipment_id",
    alias: "eq",
    missing: "The equipment was not found",
  }),
  computed: [
    "eq.equipment_type",
    "eq.location AS equipment_location",
    "eq.identifier AS equipment_identifier",
    "(t.next_due_on IS NOT NULL AND t.next_due_on < current_date) AS next_check_overdue",
    `(t.outcome IN ('fail', 'pass_with_defects') AND t.remedied_on IS NULL) AS defect_outstanding`,
  ],
  sortable: { id: "t.id", performed_on: "t.performed_on", next_due_on: "t.next_due_on" },
  defaultSort: "performed_on",
  search: ["t.defects_found", "t.remedial_action", "t.certificate_reference"],
  filters: [
    { param: "equipment_id", column: "t.equipment_id", schema: id.optional() },
    { param: "premises_id", column: "eq.premises_id", schema: id.optional() },
    {
      param: "equipment_type",
      column: "eq.equipment_type",
      schema: z.enum(EQUIPMENT_TYPES).optional(),
    },
    { param: "check_type", column: "t.check_type", schema: z.string().max(50).optional() },
    { param: "outcome", column: "t.outcome", schema: z.enum(OUTCOMES).optional() },
  ],
  dateRanges: [
    { param: "performed_on", column: "t.performed_on", schema: isoDate.optional() },
    { param: "next_due_on", column: "t.next_due_on", schema: isoDate.optional() },
  ],
  schemas: {
    create: z.strictObject(equipmentCheckFields),
    update: z.strictObject(partial(omit(equipmentCheckFields, ["equipment_id"]))),
  },
  rules: {
    async beforeCreate(body, { client, premisesId }) {
      const item = await requireRow(client, "equipment", body.equipment_id, "Equipment");

      // A check recorded against equipment that has been removed describes
      // something that is no longer there.
      if (!item.in_service) {
        throw conflict(
          "This equipment is not in service, so a check cannot be recorded against it. Put it back in service first if it has been reinstated.",
        );
      }

      assertCheckCoherent(body, null);
      notBefore(body.performed_on, item.installed_on, "performed_on", "installed_on");
      await assertScheduleFits(client, body.check_schedule_id, {
        premisesId,
        appliesTo: `equipment_type:${item.equipment_type}`,
        checkType: body.check_type,
      });

      // The interval comes from check_schedules, which is configuration rather
      // than legislation. If no schedule covers this check the record is still
      // valid; it simply has no next due date, and nothing is invented.
      if (!present(body.next_due_on)) {
        const schedule = await findSchedule(client, {
          premisesId,
          appliesTo: `equipment_type:${item.equipment_type}`,
          checkType: body.check_type,
        });
        if (schedule) body.next_due_on = addDays(body.performed_on, schedule.interval_days);
      }
      return body;
    },
    async beforeUpdate(body, before) {
      assertCheckCoherent(body, before);
      return body;
    },
    // A completed check is the evidence of maintenance under reg 12. Correcting
    // a mistake is an amendment; removing the record is not.
    beforeDelete() {
      throw conflict(
        "A recorded check evidences that the equipment was maintained under SSI 2006/456 reg 12 and is not deleted. Amend it if it was recorded wrongly.",
      );
    },
  },
};

// --- escape routes ---------------------------------------------------------

const escapeRouteFields = {
  premises_id: id,
  name: requiredText(200),
  description: optionalText(1000),
  final_exit: optionalText(300),
  capacity: z.coerce.number().int().min(0).optional().nullable(),
  travel_distance_m: z.coerce.number().min(0).max(9999).optional().nullable(),
  has_emergency_lighting: flag.optional(),
  signage_notes: optionalText(1000),
  in_service: flag.optional(),
};

export const escapeRoutes = {
  name: "escape_routes",
  label: "Escape route",
  table: "escape_routes",
  path: "/escape-routes",
  scope: ownPremises,
  timestamps: true,
  extraJoins: `LEFT JOIN LATERAL (
      SELECT c.performed_on, c.outcome, c.next_due_on, c.remedied_on
        FROM escape_route_checks c
       WHERE c.escape_route_id = t.id
       ORDER BY c.performed_on DESC, c.id DESC
       LIMIT 1
    ) last_check ON TRUE`,
  computed: [
    "last_check.performed_on AS last_checked_on",
    "last_check.outcome AS last_check_outcome",
    "last_check.next_due_on AS next_check_due",
    `(last_check.next_due_on IS NOT NULL
      AND last_check.next_due_on < current_date
      AND t.in_service) AS check_overdue`,
    `(last_check.outcome IN ('fail', 'pass_with_defects')
      AND last_check.remedied_on IS NULL) AS has_unresolved_obstruction`,
  ],
  sortable: { id: "t.id", name: "t.name", next_check_due: "last_check.next_due_on" },
  defaultSort: "name",
  search: ["t.name", "t.description", "t.final_exit"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    { param: "in_service", column: "t.in_service", schema: booleanParam() },
    {
      param: "has_emergency_lighting",
      column: "t.has_emergency_lighting",
      schema: booleanParam(),
    },
  ],
  schemas: {
    create: z.strictObject(escapeRouteFields),
    update: z.strictObject(partial(omit(escapeRouteFields, ["premises_id"]))),
  },
  rules: {
    async beforeDelete(before, { client }) {
      const checks = await countRows(
        client,
        "SELECT count(*) FROM escape_route_checks WHERE escape_route_id = $1",
        [before.id],
      );
      if (checks > 0) {
        throw conflict(
          `This route has ${checks} recorded check(s), which evidence that it was kept clear under SSI 2006/456 reg 13. Set in_service to false instead of deleting it.`,
          { checks },
        );
      }
    },
  },
};

const escapeRouteCheckFields = {
  escape_route_id: id,
  check_schedule_id: optionalId,
  performed_on: isoDate,
  performed_by_id: optionalId,
  obstructions_found: optionalText(2000),
  outcome: z.enum(OUTCOMES),
  remedial_action: optionalText(2000),
  remedied_on: isoDate.optional().nullable(),
  next_due_on: isoDate.optional().nullable(),
};

export const escapeRouteChecks = {
  name: "escape_route_checks",
  label: "Escape route check",
  table: "escape_route_checks",
  path: "/escape-route-checks",
  scope: throughTable({
    table: "escape_routes",
    key: "escape_route_id",
    alias: "er",
    missing: "The escape route was not found",
  }),
  computed: [
    "er.name AS escape_route_name",
    "er.premises_id",
    `(t.outcome IN ('fail', 'pass_with_defects') AND t.remedied_on IS NULL) AS obstruction_outstanding`,
  ],
  sortable: { id: "t.id", performed_on: "t.performed_on", next_due_on: "t.next_due_on" },
  defaultSort: "performed_on",
  search: ["t.obstructions_found", "t.remedial_action"],
  filters: [
    { param: "escape_route_id", column: "t.escape_route_id", schema: id.optional() },
    { param: "premises_id", column: "er.premises_id", schema: id.optional() },
    { param: "outcome", column: "t.outcome", schema: z.enum(OUTCOMES).optional() },
  ],
  dateRanges: [
    { param: "performed_on", column: "t.performed_on", schema: isoDate.optional() },
    { param: "next_due_on", column: "t.next_due_on", schema: isoDate.optional() },
  ],
  schemas: {
    create: z.strictObject(escapeRouteCheckFields),
    update: z.strictObject(partial(omit(escapeRouteCheckFields, ["escape_route_id"]))),
  },
  rules: {
    async beforeCreate(body, { client, premisesId }) {
      const route = await requireRow(
        client,
        "escape_routes",
        body.escape_route_id,
        "Escape route",
      );
      if (!route.in_service) {
        throw conflict(
          "This escape route is not in service, so a check cannot be recorded against it.",
        );
      }

      assertRouteCheckCoherent(body, null);
      await assertScheduleFits(client, body.check_schedule_id, {
        premisesId,
        appliesTo: "escape_route",
        checkType: null,
      });

      if (!present(body.next_due_on)) {
        const schedule =
          (await findSchedule(client, {
            premisesId,
            appliesTo: "escape_route",
            checkType: "walkthrough",
          })) ?? null;
        if (schedule) body.next_due_on = addDays(body.performed_on, schedule.interval_days);
      }
      return body;
    },
    beforeUpdate(body, before) {
      assertRouteCheckCoherent(body, before);
      return body;
    },
    beforeDelete() {
      throw conflict(
        "A recorded check evidences that the route was kept clear under SSI 2006/456 reg 13 and is not deleted. Amend it if it was recorded wrongly.",
      );
    },
  },
};

// --- shared check rules ----------------------------------------------------

function assertCheckCoherent(body, before) {
  const performedOn = resulting(body, before, "performed_on");
  const outcome = resulting(body, before, "outcome");
  const defects = resulting(body, before, "defects_found");
  const remedialAction = resulting(body, before, "remedial_action");
  const remediedOn = resulting(body, before, "remedied_on");
  const nextDue = resulting(body, before, "next_due_on");

  notInFuture(performedOn, "performed_on");
  notInFuture(remediedOn, "remedied_on");
  notBefore(remediedOn, performedOn, "remedied_on", "performed_on");
  notBefore(nextDue, performedOn, "next_due_on", "performed_on");

  if (
    !present(resulting(body, before, "performed_by_id")) &&
    !present(resulting(body, before, "performed_by_external"))
  ) {
    // Reg 12 turns on the measures being maintained by a competent person, so
    // the record has to say who did the check.
    throw ruleViolation(
      "The check must record who carried it out: set performed_by_id, or performed_by_external for a contractor",
    );
  }

  if (outcome !== "pass" && !present(defects)) {
    throw ruleViolation(
      `An outcome of ${outcome} must record what was found in defects_found`,
    );
  }
  if (outcome === "pass" && present(defects)) {
    throw ruleViolation(
      "A check that records defects did not pass. Use pass_with_defects or fail.",
    );
  }
  if (present(remediedOn) && !present(remedialAction)) {
    throw ruleViolation("remedial_action must say what was done when remedied_on is set");
  }
}

function assertRouteCheckCoherent(body, before) {
  const performedOn = resulting(body, before, "performed_on");
  const outcome = resulting(body, before, "outcome");
  const obstructions = resulting(body, before, "obstructions_found");
  const remedialAction = resulting(body, before, "remedial_action");
  const remediedOn = resulting(body, before, "remedied_on");
  const nextDue = resulting(body, before, "next_due_on");

  notInFuture(performedOn, "performed_on");
  notInFuture(remediedOn, "remedied_on");
  notBefore(remediedOn, performedOn, "remedied_on", "performed_on");
  notBefore(nextDue, performedOn, "next_due_on", "performed_on");

  if (outcome !== "pass" && !present(obstructions)) {
    throw ruleViolation(
      `An outcome of ${outcome} must record what was found in obstructions_found`,
    );
  }
  if (outcome === "pass" && present(obstructions)) {
    throw ruleViolation(
      "A check that records obstructions did not pass. Use pass_with_defects or fail.",
    );
  }
  if (present(remediedOn) && !present(remedialAction)) {
    throw ruleViolation("remedial_action must say what was done when remedied_on is set");
  }
}

// A schedule named on a check has to be one that could apply to it: the same
// premises (or the organisation-wide default) and the same kind of check.
async function assertScheduleFits(client, scheduleId, { premisesId, appliesTo, checkType }) {
  if (!present(scheduleId)) return;
  const { rows } = await client.query("SELECT * FROM check_schedules WHERE id = $1", [scheduleId]);
  const schedule = rows[0];
  if (!schedule) throw notFound(`Check schedule ${scheduleId} was not found`);

  if (schedule.premises_id !== null && schedule.premises_id !== premisesId) {
    throw ruleViolation(`Check schedule ${scheduleId} belongs to a different premises`);
  }
  if (schedule.applies_to !== appliesTo) {
    throw ruleViolation(
      `Check schedule ${scheduleId} applies to ${schedule.applies_to}, not ${appliesTo}`,
    );
  }
  if (checkType !== null && schedule.check_type !== checkType) {
    throw ruleViolation(
      `Check schedule ${scheduleId} is for a ${schedule.check_type} check, not a ${checkType} check`,
    );
  }
}

async function requireRow(client, table, rowId, label) {
  const { rows } = await client.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [rowId]);
  if (rows.length === 0) throw notFound(`${label} ${rowId} was not found`);
  return rows[0];
}

