// Incidents and enforcement.
//
// RIDDOR 2013 reg 12 is the one hard retention period in this domain: a record
// of a reportable incident is kept for three years from the date it happened.
// The schema holds that as the generated column incidents.retain_until, and the
// API refuses to delete a record before that date.
//
// Enforcement notices matter beyond their own record: an alterations notice in
// force is one of the three triggers for the duty to record under SSI 2006/456
// regs 8, 9 and 10(2), so serving or withdrawing one changes what the API
// requires elsewhere.

import { z } from "zod";
import {
  booleanParam,
  flag,
  id,
  isoDate,
  omit,
  optionalText,
  partial,
  requiredText,
} from "../../http/validate.js";
import { conflict, forbidden, ruleViolation } from "../../http/errors.js";
import { ownPremises } from "../scope.js";
import { asDate, notBefore, notInFuture, present, resulting, today } from "../rules.js";

const INCIDENT_TYPES = [
  "fire",
  "explosion",
  "dangerous_occurrence",
  "false_alarm",
  "near_miss",
  "injury",
  "other",
];

// RIDDOR 2013 reg 6 and sch.2: a reportable dangerous occurrence is notified
// without delay and the report follows within ten days.
const RIDDOR_REPORT_DAYS = 10;

const incidentFields = {
  premises_id: id,
  occurred_on: isoDate,
  occurred_at_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Must be a time such as 14:30")
    .optional()
    .nullable(),
  discovered_on: isoDate.optional().nullable(),
  incident_type: z.enum(INCIDENT_TYPES),
  location: optionalText(300),
  description: requiredText(5000),
  persons_involved: optionalText(1000),
  injuries: optionalText(2000),
  cause: optionalText(2000),
  damage: optionalText(2000),
  fire_service_attended: flag.optional(),
  riddor_reportable: flag.optional(),
  riddor_reference: optionalText(100),
  riddor_reported_on: isoDate.optional().nullable(),
  riddor_particulars: optionalText(5000),
  actions_taken: optionalText(2000),
};

export const incidents = {
  name: "incidents",
  label: "Incident",
  table: "incidents",
  path: "/incidents",
  scope: ownPremises,
  timestamps: true,
  computed: [
    // Whether a reportable incident is still awaiting its report, and whether
    // the ten days have run out, is the kind of thing a client should be told
    // rather than left to compute.
    `(t.riddor_reportable AND t.riddor_reported_on IS NULL) AS riddor_report_outstanding`,
    `(t.riddor_reportable
      AND t.riddor_reported_on IS NULL
      AND COALESCE(t.discovered_on, t.occurred_on) + ${RIDDOR_REPORT_DAYS} < current_date) AS riddor_report_overdue`,
    "(t.retain_until >= current_date) AS within_retention_period",
    `(t.riddor_reportable
      AND t.riddor_reported_on IS NOT NULL
      AND t.riddor_reported_on > COALESCE(t.discovered_on, t.occurred_on) + ${RIDDOR_REPORT_DAYS}) AS riddor_reported_late`,
  ],
  sortable: { id: "t.id", occurred_on: "t.occurred_on", incident_type: "t.incident_type" },
  defaultSort: "occurred_on",
  search: ["t.description", "t.location", "t.cause", "t.riddor_reference"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    {
      param: "incident_type",
      column: "t.incident_type",
      schema: z.enum(INCIDENT_TYPES).optional(),
    },
    { param: "riddor_reportable", column: "t.riddor_reportable", schema: booleanParam() },
    {
      param: "fire_service_attended",
      column: "t.fire_service_attended",
      schema: booleanParam(),
    },
  ],
  dateRanges: [{ param: "occurred_on", column: "t.occurred_on", schema: isoDate.optional() }],
  schemas: {
    create: z.strictObject(incidentFields),
    update: z.strictObject(partial(omit(incidentFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      assertIncidentCoherent(body, null);
      return body;
    },
    beforeUpdate(body, before) {
      assertIncidentCoherent(body, before);
      return body;
    },
    // The one retention period fixed by legislation. Deleting inside it would
    // destroy a record the duty holder is required to keep, so it is refused
    // whatever the caller's role.
    beforeDelete(before) {
      const retainUntil = asDate(before.retain_until);
      if (before.riddor_reportable && retainUntil >= today()) {
        throw forbidden(
          `This incident was reportable under RIDDOR 2013, so the record is kept until ${retainUntil} (reg 12, three years from the date it occurred).`,
          { retain_until: retainUntil },
        );
      }
    },
  },
};

function assertIncidentCoherent(body, before) {
  const occurredOn = resulting(body, before, "occurred_on");
  const discoveredOn = resulting(body, before, "discovered_on");
  const reportable = resulting(body, before, "riddor_reportable");
  const reportedOn = resulting(body, before, "riddor_reported_on");
  const reference = resulting(body, before, "riddor_reference");
  const particulars = resulting(body, before, "riddor_particulars");

  notInFuture(occurredOn, "occurred_on");
  notInFuture(discoveredOn, "discovered_on");
  notInFuture(reportedOn, "riddor_reported_on");
  // A fire found on Monday may have started on Sunday, so discovery is on or
  // after the event, never before it.
  notBefore(discoveredOn, occurredOn, "discovered_on", "occurred_on");
  notBefore(reportedOn, occurredOn, "riddor_reported_on", "occurred_on");

  if (reportable) {
    assertRiddorReportRecorded(particulars, reference, reportedOn);
  } else {
    assertNotReportedWithoutBeingReportable(reportedOn, reference);
  }
}

// Being reported to the enforcing authority is what makes an incident
// reportable. A reference or a report date on an incident marked not
// reportable is a contradiction, and reg 12 turns on which it is.
function assertNotReportedWithoutBeingReportable(reportedOn, reference) {
  if (!present(reportedOn) && !present(reference)) return;
  throw ruleViolation(
    "This incident is marked as not reportable under RIDDOR, but carries a report date or reference. Set riddor_reportable if it was reported.",
  );
}

function assertRiddorReportRecorded(particulars, reference, reportedOn) {
  // Reg 12(1)(b): the record of a reportable incident keeps the particulars
  // that had to be notified.
  if (!present(particulars)) {
    throw ruleViolation(
      "riddor_particulars must record the particulars notified to the enforcing authority (RIDDOR 2013 reg 12)",
    );
  }
  if (present(reference) && !present(reportedOn)) {
    throw ruleViolation(
      "riddor_reported_on must record when the report carrying that reference was made",
    );
  }
  // Reg 6 requires the report within ten days of the incident coming to the
  // duty holder's knowledge. A report later than that is not refused: the
  // record has to be able to say what actually happened, and refusing it would
  // only produce a record that is silent about the delay. It is reported back
  // instead, as the computed riddor_reported_late flag.
}

// --- enforcement notices ---------------------------------------------------

const NOTICE_TYPES = ["alterations", "enforcement", "prohibition", "other"];

const noticeFields = {
  premises_id: id,
  notice_type: z.enum(NOTICE_TYPES),
  reference: optionalText(100),
  authority: optionalText(200),
  served_on: isoDate,
  in_force: flag.optional(),
  withdrawn_on: isoDate.optional().nullable(),
  requirements: optionalText(5000),
  response: optionalText(5000),
  complied_on: isoDate.optional().nullable(),
};

export const enforcementNotices = {
  name: "enforcement_notices",
  label: "Enforcement notice",
  table: "enforcement_notices",
  path: "/enforcement-notices",
  scope: ownPremises,
  // A notice served by the enforcing authority is not an everyday record.
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "admin" },
  computed: ["(t.in_force AND t.complied_on IS NULL) AS outstanding"],
  sortable: { id: "t.id", served_on: "t.served_on", notice_type: "t.notice_type" },
  defaultSort: "served_on",
  search: ["t.reference", "t.authority", "t.requirements", "t.response"],
  filters: [
    { param: "premises_id", column: "t.premises_id", schema: id.optional() },
    { param: "notice_type", column: "t.notice_type", schema: z.enum(NOTICE_TYPES).optional() },
    { param: "in_force", column: "t.in_force", schema: booleanParam() },
  ],
  dateRanges: [{ param: "served_on", column: "t.served_on", schema: isoDate.optional() }],
  schemas: {
    create: z.strictObject(noticeFields),
    update: z.strictObject(partial(omit(noticeFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      assertNoticeCoherent(body, null);
      return body;
    },
    beforeUpdate(body, before) {
      assertNoticeCoherent(body, before);
      return body;
    },
    // An alterations notice in force is one of the three triggers for the duty
    // to record. Deleting the notice would silently remove the duty, so a
    // notice in force is withdrawn rather than deleted.
    beforeDelete(before) {
      if (before.in_force) {
        throw conflict(
          "This notice is still in force. Record its withdrawal — set in_force to false and withdrawn_on — rather than deleting it, so the history of what the premises was subject to is kept.",
        );
      }
    },
  },
};

// fallow-ignore-next-line complexity
function assertNoticeCoherent(body, before) {
  const servedOn = resulting(body, before, "served_on");
  const inForce = resulting(body, before, "in_force") ?? true;
  const withdrawnOn = resulting(body, before, "withdrawn_on");
  const compliedOn = resulting(body, before, "complied_on");

  notInFuture(servedOn, "served_on");
  notInFuture(withdrawnOn, "withdrawn_on");
  notInFuture(compliedOn, "complied_on");
  notBefore(withdrawnOn, servedOn, "withdrawn_on", "served_on");
  notBefore(compliedOn, servedOn, "complied_on", "served_on");

  if (!inForce && !present(withdrawnOn) && !present(compliedOn)) {
    throw ruleViolation(
      "A notice no longer in force must record why: set withdrawn_on if the authority withdrew it, or complied_on if its requirements were met",
    );
  }
  if (inForce && present(withdrawnOn)) {
    throw ruleViolation(
      "A withdrawn notice is not in force. Set in_force to false, or clear withdrawn_on.",
    );
  }
}

// --- enforcement visits ----------------------------------------------------

const visitFields = {
  premises_id: id,
  authority: optionalText(200),
  officer_name: optionalText(200),
  visited_on: isoDate,
  purpose: optionalText(500),
  documents_provided: optionalText(2000),
  findings: optionalText(5000),
};

export const enforcementVisits = {
  name: "enforcement_visits",
  label: "Enforcement visit",
  table: "enforcement_visits",
  path: "/enforcement-visits",
  scope: ownPremises,
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  sortable: { id: "t.id", visited_on: "t.visited_on" },
  defaultSort: "visited_on",
  search: ["t.authority", "t.officer_name", "t.purpose", "t.findings"],
  filters: [{ param: "premises_id", column: "t.premises_id", schema: id.optional() }],
  dateRanges: [{ param: "visited_on", column: "t.visited_on", schema: isoDate.optional() }],
  schemas: {
    create: z.strictObject(visitFields),
    update: z.strictObject(partial(omit(visitFields, ["premises_id"]))),
  },
  rules: {
    beforeCreate(body) {
      notInFuture(body.visited_on, "visited_on");
      return body;
    },
    beforeUpdate(body, before) {
      notInFuture(resulting(body, before, "visited_on"), "visited_on");
      return body;
    },
  },
};

