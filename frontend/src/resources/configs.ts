// Config for the sixteen resources served by the generic list/create/edit
// engine (src/pages/resource). Premises, fire risk assessments, equipment and
// escape routes get bespoke pages instead, because their forms are inherently
// nested (an assessment's findings and measures, a piece of equipment's check
// history) rather than one flat row. Legal basis and Schedule 2 measures are
// reference tables the API only ever lists, so they get a read-only viewer.

import type { Row } from "../types/api";
import type { ResourceConfig } from "./types";

const yesNo = (key: string) => (row: Row) => (row[key] ? "Yes" : "No");
const dateCol = (key: string) => (row: Row) => formatDateCell(row[key]);

function formatDateCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function overdueBadge(flagKey: string, label = "Overdue") {
  return (row: Row) => (row[flagKey] ? { text: label, tone: "red" as const } : null);
}

const PREMISES_FILTER = {
  param: "premises_id",
  label: "Premises",
  field: { kind: "resource" as const, resourcePath: "/premises", labelKey: "name" },
};

// --- people ------------------------------------------------------------

const people: ResourceConfig = {
  name: "people",
  label: "Person",
  labelPlural: "People",
  path: "/people",
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  removable: true,
  premisesScoped: false,
  searchable: true,
  defaultSort: "full_name",
  sortable: [
    { key: "full_name", label: "Name" },
    { key: "started_on", label: "Started" },
    { key: "id", label: "ID" },
  ],
  helpText:
    "Staff move between sites and an external assessor may work across several, so a person is not owned by one premises: managers and admins see the whole directory, everyone else only people connected to a premises they cover.",
  columns: [
    { key: "full_name", label: "Name" },
    { key: "job_title", label: "Job title" },
    { key: "email", label: "Email" },
    { key: "is_employee", label: "Employee", render: yesNo("is_employee") },
    {
      key: "ended_on",
      label: "Status",
      badge: (row) => (row.ended_on ? { text: "Left", tone: "neutral" } : { text: "Current", tone: "green" }),
    },
  ],
  filters: [{ param: "is_employee", label: "Employee", field: { kind: "boolean" } }],
  fields: [
    { key: "full_name", label: "Full name", field: { kind: "text", maxLength: 200 }, requiredOnCreate: true },
    { key: "job_title", label: "Job title", field: { kind: "text", maxLength: 150 } },
    { key: "email", label: "Email", field: { kind: "text", maxLength: 320 } },
    { key: "phone", label: "Phone", field: { kind: "text", maxLength: 50 } },
    { key: "is_employee", label: "Employee", field: { kind: "boolean" } },
    { key: "started_on", label: "Started on", field: { kind: "date" } },
    {
      key: "ended_on",
      label: "Ended on",
      field: { kind: "date" },
      help: "Set this to close the record instead of deleting a person who appears in training or risk records.",
    },
    { key: "notes", label: "Notes", field: { kind: "textarea" } },
  ],
};

// --- safety roles --------------------------------------------------------

const SAFETY_ROLES = ["nominated_firefighting", "competent_assistance", "fire_warden", "duty_holder", "other"];
const SAFETY_ROLE_LABELS: Record<string, string> = {
  nominated_firefighting: "Nominated firefighting",
  competent_assistance: "Competent assistance",
  fire_warden: "Fire warden",
  duty_holder: "Duty holder",
  other: "Other",
};

const safetyRoles: ResourceConfig = {
  name: "safety_roles",
  label: "Safety role",
  labelPlural: "Safety roles",
  path: "/safety-roles",
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  removable: true,
  premisesScoped: true,
  defaultSort: "appointed_on",
  sortable: [
    { key: "appointed_on", label: "Appointed" },
    { key: "role", label: "Role" },
  ],
  helpText: "Fire (Scotland) Act 2005 s.53(4) and SSI 2006/456 reg 15 — who is nominated for firefighting duties, evacuation and competent assistance.",
  columns: [
    { key: "person_name", label: "Person" },
    { key: "role", label: "Role", render: (row) => SAFETY_ROLE_LABELS[String(row.role)] ?? String(row.role) },
    { key: "appointed_on", label: "Appointed", render: dateCol("appointed_on") },
    {
      key: "is_active",
      label: "Status",
      badge: (row) => (row.is_active ? { text: "Active", tone: "green" } : { text: "Ended", tone: "neutral" }),
    },
  ],
  filters: [
    PREMISES_FILTER,
    { param: "role", label: "Role", field: { kind: "enum", options: SAFETY_ROLES, labels: SAFETY_ROLE_LABELS } },
  ],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    {
      key: "person_id",
      label: "Person",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "role", label: "Role", field: { kind: "enum", options: SAFETY_ROLES, labels: SAFETY_ROLE_LABELS }, requiredOnCreate: true },
    { key: "appointed_on", label: "Appointed on", field: { kind: "date" } },
    { key: "ended_on", label: "Ended on", field: { kind: "date" } },
    {
      key: "competence_evidence",
      label: "Competence evidence",
      field: { kind: "textarea" },
      help: "Required for nominated firefighting and competent assistance roles: what training, experience or qualification the appointment relies on.",
    },
    { key: "legal_basis_code", label: "Legal basis code", field: { kind: "resource-code", resourcePath: "/legal-basis", labelKey: (r) => `${r.code} — ${String(r.provision ?? "")}` } },
  ],
};

// --- fire safety arrangements (reg 10) -----------------------------------

const arrangements: ResourceConfig = {
  name: "fire_safety_arrangements",
  label: "Fire safety arrangement",
  labelPlural: "Fire safety arrangements",
  path: "/fire-safety-arrangements",
  permissions: { read: "viewer", create: "assessor", update: "assessor", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "effective_from",
  sortable: [
    { key: "effective_from", label: "Effective from" },
    { key: "schedule2_measure_code", label: "Measure" },
  ],
  helpText:
    "SSI 2006/456 reg 10(1): arrangements for the planning, organisation, control, monitoring and review of the fire safety measures. Creating a new one for the same measure supersedes the previous version, which is kept as history.",
  columns: [
    { key: "measure_description", label: "Measure" },
    { key: "effective_from", label: "Effective from", render: dateCol("effective_from") },
    {
      key: "is_current",
      label: "Status",
      badge: (row) => (row.is_current ? { text: "Current", tone: "green" } : { text: "Superseded", tone: "neutral" }),
    },
  ],
  filters: [PREMISES_FILTER],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    {
      key: "schedule2_measure_code",
      label: "Schedule 2 measure",
      field: { kind: "resource-code", resourcePath: "/schedule2-measures", labelKey: (r) => `${r.code} — ${String(r.description ?? "")}` },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "planning", label: "Planning", field: { kind: "textarea" } },
    { key: "organisation", label: "Organisation", field: { kind: "textarea" } },
    { key: "control", label: "Control", field: { kind: "textarea" } },
    { key: "monitoring", label: "Monitoring", field: { kind: "textarea" } },
    { key: "review", label: "Review", field: { kind: "textarea" } },
    {
      key: "responsible_person_id",
      label: "Responsible person",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
    },
    { key: "effective_from", label: "Effective from", field: { kind: "date" } },
  ],
};

// --- dangerous substances (regs 6-7, DSEAR) ------------------------------

const dangerousSubstances: ResourceConfig = {
  name: "dangerous_substances",
  label: "Dangerous substance",
  labelPlural: "Dangerous substances",
  path: "/dangerous-substances",
  permissions: { read: "viewer", create: "assessor", update: "assessor", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "name",
  sortable: [
    { key: "name", label: "Name" },
    { key: "assessed_on", label: "Assessed" },
  ],
  helpText: "SSI 2006/456 regs 6-7 and DSEAR 2002 — dangerous substances and the fire and explosion risk they present.",
  columns: [
    { key: "name", label: "Name" },
    { key: "location", label: "Location" },
    { key: "explosive_atmosphere_likely", label: "Explosive atmosphere", render: yesNo("explosive_atmosphere_likely") },
    { key: "assessed_on", label: "Assessed", render: dateCol("assessed_on") },
  ],
  filters: [PREMISES_FILTER, { param: "explosive_atmosphere_likely", label: "Explosive atmosphere likely", field: { kind: "boolean" } }],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "name", label: "Name", field: { kind: "text", maxLength: 200 }, requiredOnCreate: true },
    { key: "quantity", label: "Quantity", field: { kind: "text", maxLength: 100 } },
    { key: "location", label: "Location", field: { kind: "text", maxLength: 300 } },
    { key: "hazardous_properties", label: "Hazardous properties", field: { kind: "textarea" } },
    { key: "supplier_safety_data_ref", label: "Safety data sheet reference", field: { kind: "text", maxLength: 200 } },
    { key: "ignition_sources", label: "Ignition sources", field: { kind: "textarea" } },
    { key: "explosive_atmosphere_likely", label: "Explosive atmosphere likely", field: { kind: "boolean" } },
    {
      key: "explosive_atmosphere_notes",
      label: "Explosive atmosphere notes",
      field: { kind: "textarea" },
      help: "Required when an explosive atmosphere is likely: describe the circumstances in which it may occur.",
    },
    {
      key: "hazardous_area_classification",
      label: "Hazardous area classification",
      field: { kind: "text", maxLength: 200 },
      help: "Required when an explosive atmosphere is likely (DSEAR reg 7 and sch.2): the zone.",
    },
    { key: "area_marked", label: "Area marked", field: { kind: "boolean" } },
    { key: "assessed_on", label: "Assessed on", field: { kind: "date" } },
    {
      key: "assessed_by_id",
      label: "Assessed by",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
    },
  ],
};

// --- check schedules -------------------------------------------------------

const checkSchedules: ResourceConfig = {
  name: "check_schedules",
  label: "Check schedule",
  labelPlural: "Check schedules",
  path: "/check-schedules",
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  removable: true,
  premisesScoped: false,
  searchable: true,
  defaultSort: "applies_to",
  sortable: [
    { key: "applies_to", label: "Applies to" },
    { key: "interval_days", label: "Interval" },
  ],
  helpText:
    "No test or inspection interval here is fixed by legislation — every one comes from Scottish Government guidance or a British Standard. A schedule with no premises set is the organisation-wide default.",
  columns: [
    { key: "applies_to", label: "Applies to" },
    { key: "check_type", label: "Check type" },
    { key: "interval_days", label: "Interval (days)" },
    { key: "recommended_by", label: "Recommended by" },
    { key: "is_statutory", label: "Statutory", render: yesNo("is_statutory") },
  ],
  filters: [
    PREMISES_FILTER,
    { param: "is_statutory", label: "Statutory", field: { kind: "boolean" } },
  ],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      help: "Leave blank for an organisation-wide default used wherever a premises has not set its own.",
      createOnly: true,
    },
    { key: "applies_to", label: "Applies to", field: { kind: "text", maxLength: 100 }, requiredOnCreate: true, help: "e.g. equipment_type:extinguisher, escape_route, training:induction" },
    { key: "check_type", label: "Check type", field: { kind: "text", maxLength: 50 }, requiredOnCreate: true },
    { key: "interval_days", label: "Interval (days)", field: { kind: "number", min: 1, max: 3650 }, requiredOnCreate: true },
    { key: "recommended_by", label: "Recommended by", field: { kind: "text", maxLength: 200 }, help: "Required if marked statutory: the citation." },
    { key: "is_statutory", label: "Statutory", field: { kind: "boolean" }, help: "Admin only. Requires a citation in recommended_by." },
    { key: "notes", label: "Notes", field: { kind: "textarea" } },
  ],
};

// --- emergency procedures (reg 14) ---------------------------------------

const emergencyProcedures: ResourceConfig = {
  name: "emergency_procedures",
  label: "Emergency procedure",
  labelPlural: "Emergency procedures",
  path: "/emergency-procedures",
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "effective_from",
  sortable: [
    { key: "effective_from", label: "Effective from" },
    { key: "version", label: "Version" },
  ],
  helpText: "SSI 2006/456 reg 14 — procedures for serious and imminent danger. A new version supersedes the last one, which is kept as the record of what was in force at the time.",
  columns: [
    { key: "title", label: "Title" },
    { key: "version", label: "Version" },
    { key: "effective_from", label: "Effective from", render: dateCol("effective_from") },
    {
      key: "is_current",
      label: "Status",
      badge: (row) => (row.is_current ? { text: "Current", tone: "green" } : { text: "Superseded", tone: "neutral" }),
    },
  ],
  filters: [PREMISES_FILTER],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "title", label: "Title", field: { kind: "text", maxLength: 200 }, requiredOnCreate: true },
    { key: "procedure", label: "Procedure", field: { kind: "textarea", rows: 10 }, requiredOnCreate: true },
    { key: "effective_from", label: "Effective from", field: { kind: "date" } },
  ],
};

// --- fire drills -----------------------------------------------------------

const fireDrills: ResourceConfig = {
  name: "fire_drills",
  label: "Fire drill",
  labelPlural: "Fire drills",
  path: "/fire-drills",
  permissions: { read: "viewer", create: "assessor", update: "assessor", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "held_at",
  sortable: [{ key: "held_at", label: "Held at" }],
  helpText: "Reg 14(1) requires the emergency procedures to be effective; a drill is how that is tested.",
  columns: [
    { key: "held_at", label: "Held at", render: (row) => (row.held_at ? new Date(String(row.held_at)).toLocaleString("en-GB") : "—") },
    { key: "conducted_by_name", label: "Conducted by" },
    { key: "persons_participating", label: "Participants" },
    {
      key: "issues_identified",
      label: "Issues",
      badge: (row) => (row.issues_identified ? { text: "Issues found", tone: "amber" } : { text: "No issues", tone: "green" }),
    },
  ],
  filters: [PREMISES_FILTER],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "held_at", label: "Held at", field: { kind: "datetime" }, requiredOnCreate: true },
    { key: "scenario", label: "Scenario", field: { kind: "textarea" } },
    { key: "evacuation_time_seconds", label: "Evacuation time (seconds)", field: { kind: "number", min: 1, max: 7200 } },
    { key: "persons_participating", label: "Persons participating", field: { kind: "number", min: 0 } },
    { key: "wardens_present", label: "Wardens present", field: { kind: "text", maxLength: 500 } },
    { key: "issues_identified", label: "Issues identified", field: { kind: "textarea" } },
    {
      key: "actions_taken",
      label: "Actions taken",
      field: { kind: "textarea" },
      help: "Required if issues were identified.",
    },
    {
      key: "conducted_by_id",
      label: "Conducted by",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
    },
  ],
};

// --- training records (reg 20) ---------------------------------------------

const TRAINING_TYPES = ["induction", "new_or_changed_risk", "refresher", "fire_warden", "extinguisher_use", "evacuation_aid", "other"];
const TRAINING_TYPE_LABELS: Record<string, string> = {
  induction: "Induction",
  new_or_changed_risk: "New or changed risk",
  refresher: "Refresher",
  fire_warden: "Fire warden",
  extinguisher_use: "Extinguisher use",
  evacuation_aid: "Evacuation aid",
  other: "Other",
};

const trainingRecords: ResourceConfig = {
  name: "training_records",
  label: "Training record",
  labelPlural: "Training records",
  path: "/training-records",
  permissions: { read: "viewer", create: "assessor", update: "assessor", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "delivered_on",
  sortable: [
    { key: "delivered_on", label: "Delivered" },
    { key: "next_due_on", label: "Next due" },
    { key: "person_name", label: "Person" },
  ],
  helpText: "SSI 2006/456 reg 20 — training on joining, on a changed risk, and repeated periodically.",
  columns: [
    { key: "person_name", label: "Person" },
    { key: "training_type", label: "Type", render: (row) => TRAINING_TYPE_LABELS[String(row.training_type)] ?? String(row.training_type) },
    { key: "delivered_on", label: "Delivered", render: dateCol("delivered_on") },
    { key: "next_due_on", label: "Next due", render: dateCol("next_due_on"), badge: overdueBadge("refresher_overdue") },
  ],
  filters: [
    PREMISES_FILTER,
    { param: "person_id", label: "Person", field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" } },
    { param: "training_type", label: "Type", field: { kind: "enum", options: TRAINING_TYPES, labels: TRAINING_TYPE_LABELS } },
  ],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    {
      key: "person_id",
      label: "Person",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "training_type", label: "Training type", field: { kind: "enum", options: TRAINING_TYPES, labels: TRAINING_TYPE_LABELS }, requiredOnCreate: true },
    { key: "delivered_on", label: "Delivered on", field: { kind: "date" }, requiredOnCreate: true },
    {
      key: "delivered_by_id",
      label: "Delivered by",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
    },
    { key: "provider", label: "Provider", field: { kind: "text", maxLength: 200 } },
    { key: "content_summary", label: "Content summary", field: { kind: "textarea" } },
    { key: "during_working_hours", label: "During working hours", field: { kind: "boolean" } },
    { key: "next_due_on", label: "Next due on", field: { kind: "date" } },
  ],
};

// --- information to employees (reg 21) -------------------------------------

const INFORMATION_TYPES = ["risks_identified", "preventive_measures", "nominated_person_identities", "dangerous_substances", "emergency_procedures", "other"];
const INFORMATION_TYPE_LABELS: Record<string, string> = {
  risks_identified: "Risks identified",
  preventive_measures: "Preventive measures",
  nominated_person_identities: "Nominated person identities",
  dangerous_substances: "Dangerous substances",
  emergency_procedures: "Emergency procedures",
  other: "Other",
};

const informationRecords: ResourceConfig = {
  name: "employee_information_records",
  label: "Information record",
  labelPlural: "Information records",
  path: "/employee-information-records",
  permissions: { read: "viewer", create: "assessor", update: "assessor", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "provided_on",
  sortable: [{ key: "provided_on", label: "Provided" }],
  helpText: "SSI 2006/456 reg 21 — information given to employees on risks, measures, nominated persons and dangerous substances.",
  columns: [
    { key: "person_name", label: "Person" },
    { key: "group_description", label: "Group" },
    { key: "information_type", label: "Type", render: (row) => INFORMATION_TYPE_LABELS[String(row.information_type)] ?? String(row.information_type) },
    { key: "provided_on", label: "Provided", render: dateCol("provided_on") },
  ],
  filters: [
    PREMISES_FILTER,
    { param: "person_id", label: "Person", field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" } },
    { param: "information_type", label: "Type", field: { kind: "enum", options: INFORMATION_TYPES, labels: INFORMATION_TYPE_LABELS } },
  ],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    {
      key: "person_id",
      label: "Person",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
      help: "Give either a person, or a group description below.",
    },
    { key: "group_description", label: "Group description", field: { kind: "text", maxLength: 300 } },
    { key: "information_type", label: "Information type", field: { kind: "enum", options: INFORMATION_TYPES, labels: INFORMATION_TYPE_LABELS }, requiredOnCreate: true },
    { key: "provided_on", label: "Provided on", field: { kind: "date" }, requiredOnCreate: true },
    { key: "method", label: "Method", field: { kind: "text", maxLength: 200 } },
    {
      key: "provided_by_id",
      label: "Provided by",
      field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
    },
    { key: "notes", label: "Notes", field: { kind: "textarea" } },
  ],
};

// --- cooperation records (reg 18) ------------------------------------------

const cooperationRecords: ResourceConfig = {
  name: "cooperation_records",
  label: "Cooperation record",
  labelPlural: "Cooperation records",
  path: "/cooperation-records",
  permissions: { read: "viewer", create: "assessor", update: "assessor", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "recorded_on",
  sortable: [{ key: "recorded_on", label: "Recorded" }],
  helpText: "SSI 2006/456 reg 18 — cooperation and coordination where more than one duty holder is involved.",
  columns: [
    { key: "other_duty_holder", label: "Other duty holder" },
    { key: "recorded_on", label: "Recorded", render: dateCol("recorded_on") },
  ],
  filters: [PREMISES_FILTER],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "other_duty_holder", label: "Other duty holder", field: { kind: "text", maxLength: 200 }, requiredOnCreate: true },
    { key: "contact_details", label: "Contact details", field: { kind: "textarea" } },
    { key: "arrangements", label: "Arrangements", field: { kind: "textarea" }, help: "Record what was coordinated, or what was shared in information_shared below." },
    { key: "information_shared", label: "Information shared", field: { kind: "textarea" } },
    { key: "recorded_on", label: "Recorded on", field: { kind: "date" } },
  ],
};

// --- health and safety policies (HSWA 1974 s.2(3)) -------------------------

const healthSafetyPolicies: ResourceConfig = {
  name: "health_safety_policies",
  label: "Health and safety policy",
  labelPlural: "Health and safety policies",
  path: "/health-safety-policies",
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  removable: true,
  premisesScoped: false,
  searchable: true,
  defaultSort: "effective_from",
  sortable: [
    { key: "effective_from", label: "Effective from" },
    { key: "version", label: "Version" },
  ],
  helpText: "HSWA 1974 s.2(3) — the written policy, required where five or more people are employed. May be written once for the organisation or separately per premises.",
  columns: [
    { key: "version", label: "Version" },
    { key: "effective_from", label: "Effective from", render: dateCol("effective_from") },
    {
      key: "is_current",
      label: "Status",
      badge: (row) => (row.is_current ? { text: "Current", tone: "green" } : { text: "Superseded", tone: "neutral" }),
    },
  ],
  filters: [PREMISES_FILTER],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      help: "Leave blank for one organisation-wide policy, or set to write one for a specific premises.",
      createOnly: true,
    },
    { key: "statement", label: "Statement", field: { kind: "textarea", rows: 12 }, requiredOnCreate: true },
    { key: "effective_from", label: "Effective from", field: { kind: "date" } },
  ],
};

// --- incidents (RIDDOR 2013) -----------------------------------------------

const INCIDENT_TYPES = ["fire", "explosion", "dangerous_occurrence", "false_alarm", "near_miss", "injury", "other"];
const INCIDENT_TYPE_LABELS: Record<string, string> = {
  fire: "Fire",
  explosion: "Explosion",
  dangerous_occurrence: "Dangerous occurrence",
  false_alarm: "False alarm",
  near_miss: "Near miss",
  injury: "Injury",
  other: "Other",
};

const incidents: ResourceConfig = {
  name: "incidents",
  label: "Incident",
  labelPlural: "Incidents",
  path: "/incidents",
  permissions: { read: "viewer", create: "assessor", update: "assessor", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "occurred_on",
  sortable: [
    { key: "occurred_on", label: "Occurred" },
    { key: "incident_type", label: "Type" },
  ],
  helpText: "RIDDOR 2013 reg 12 fixes a three-year retention period for a reportable incident (retain_until), the one hard retention rule in this domain.",
  columns: [
    { key: "occurred_on", label: "Occurred", render: dateCol("occurred_on") },
    { key: "incident_type", label: "Type", render: (row) => INCIDENT_TYPE_LABELS[String(row.incident_type)] ?? String(row.incident_type) },
    { key: "location", label: "Location" },
    {
      key: "riddor_reportable",
      label: "RIDDOR",
      badge: (row) => {
        if (!row.riddor_reportable) return null;
        if (row.riddor_report_overdue) return { text: "Report overdue", tone: "red" };
        if (row.riddor_report_outstanding) return { text: "Report due", tone: "amber" };
        return { text: "Reported", tone: "green" };
      },
    },
  ],
  filters: [
    PREMISES_FILTER,
    { param: "incident_type", label: "Type", field: { kind: "enum", options: INCIDENT_TYPES, labels: INCIDENT_TYPE_LABELS } },
    { param: "riddor_reportable", label: "RIDDOR reportable", field: { kind: "boolean" } },
    { param: "fire_service_attended", label: "Fire service attended", field: { kind: "boolean" } },
  ],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "occurred_on", label: "Occurred on", field: { kind: "date" }, requiredOnCreate: true },
    { key: "occurred_at_time", label: "Time (HH:MM)", field: { kind: "time" } },
    { key: "discovered_on", label: "Discovered on", field: { kind: "date" } },
    { key: "incident_type", label: "Incident type", field: { kind: "enum", options: INCIDENT_TYPES, labels: INCIDENT_TYPE_LABELS }, requiredOnCreate: true },
    { key: "location", label: "Location", field: { kind: "text", maxLength: 300 } },
    { key: "description", label: "Description", field: { kind: "textarea" }, requiredOnCreate: true },
    { key: "persons_involved", label: "Persons involved", field: { kind: "textarea" } },
    { key: "injuries", label: "Injuries", field: { kind: "textarea" } },
    { key: "cause", label: "Cause", field: { kind: "textarea" } },
    { key: "damage", label: "Damage", field: { kind: "textarea" } },
    { key: "fire_service_attended", label: "Fire service attended", field: { kind: "boolean" } },
    { key: "riddor_reportable", label: "RIDDOR reportable", field: { kind: "boolean" } },
    { key: "riddor_reference", label: "RIDDOR reference", field: { kind: "text", maxLength: 100 } },
    { key: "riddor_reported_on", label: "RIDDOR reported on", field: { kind: "date" } },
    {
      key: "riddor_particulars",
      label: "RIDDOR particulars",
      field: { kind: "textarea" },
      help: "Required when marked RIDDOR reportable: the particulars notified to the enforcing authority.",
    },
    { key: "actions_taken", label: "Actions taken", field: { kind: "textarea" } },
  ],
};

// --- enforcement notices -----------------------------------------------------

const NOTICE_TYPES = ["alterations", "enforcement", "prohibition", "other"];
const NOTICE_TYPE_LABELS: Record<string, string> = {
  alterations: "Alterations",
  enforcement: "Enforcement",
  prohibition: "Prohibition",
  other: "Other",
};

const enforcementNotices: ResourceConfig = {
  name: "enforcement_notices",
  label: "Enforcement notice",
  labelPlural: "Enforcement notices",
  path: "/enforcement-notices",
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "admin" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "served_on",
  sortable: [
    { key: "served_on", label: "Served" },
    { key: "notice_type", label: "Type" },
  ],
  helpText: "An alterations notice in force is one of the three triggers for the duty to record under SSI 2006/456.",
  columns: [
    { key: "notice_type", label: "Type", render: (row) => NOTICE_TYPE_LABELS[String(row.notice_type)] ?? String(row.notice_type) },
    { key: "reference", label: "Reference" },
    { key: "served_on", label: "Served", render: dateCol("served_on") },
    {
      key: "in_force",
      label: "Status",
      badge: (row) => (row.in_force ? { text: row.outstanding ? "Outstanding" : "In force", tone: row.outstanding ? "amber" : "blue" } : { text: "Closed", tone: "neutral" }),
    },
  ],
  filters: [
    PREMISES_FILTER,
    { param: "notice_type", label: "Type", field: { kind: "enum", options: NOTICE_TYPES, labels: NOTICE_TYPE_LABELS } },
    { param: "in_force", label: "In force", field: { kind: "boolean" } },
  ],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "notice_type", label: "Notice type", field: { kind: "enum", options: NOTICE_TYPES, labels: NOTICE_TYPE_LABELS }, requiredOnCreate: true },
    { key: "reference", label: "Reference", field: { kind: "text", maxLength: 100 } },
    { key: "authority", label: "Authority", field: { kind: "text", maxLength: 200 } },
    { key: "served_on", label: "Served on", field: { kind: "date" }, requiredOnCreate: true },
    { key: "in_force", label: "In force", field: { kind: "boolean" } },
    {
      key: "withdrawn_on",
      label: "Withdrawn on",
      field: { kind: "date" },
      help: "A notice no longer in force must record why: set this, or complied_on below.",
    },
    { key: "requirements", label: "Requirements", field: { kind: "textarea" } },
    { key: "response", label: "Response", field: { kind: "textarea" } },
    { key: "complied_on", label: "Complied on", field: { kind: "date" } },
  ],
};

// --- enforcement visits ------------------------------------------------------

const enforcementVisits: ResourceConfig = {
  name: "enforcement_visits",
  label: "Enforcement visit",
  labelPlural: "Enforcement visits",
  path: "/enforcement-visits",
  permissions: { read: "viewer", create: "manager", update: "manager", remove: "manager" },
  removable: true,
  premisesScoped: true,
  searchable: true,
  defaultSort: "visited_on",
  sortable: [{ key: "visited_on", label: "Visited" }],
  columns: [
    { key: "visited_on", label: "Visited", render: dateCol("visited_on") },
    { key: "authority", label: "Authority" },
    { key: "officer_name", label: "Officer" },
    { key: "purpose", label: "Purpose" },
  ],
  filters: [PREMISES_FILTER],
  fields: [
    {
      key: "premises_id",
      label: "Premises",
      field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
      requiredOnCreate: true,
      createOnly: true,
    },
    { key: "authority", label: "Authority", field: { kind: "text", maxLength: 200 } },
    { key: "officer_name", label: "Officer name", field: { kind: "text", maxLength: 200 } },
    { key: "visited_on", label: "Visited on", field: { kind: "date" }, requiredOnCreate: true },
    { key: "purpose", label: "Purpose", field: { kind: "text", maxLength: 500 } },
    { key: "documents_provided", label: "Documents provided", field: { kind: "textarea" } },
    { key: "findings", label: "Findings", field: { kind: "textarea" } },
  ],
};

// --- reference tables (list only) -------------------------------------------

const legalBasis: ResourceConfig = {
  name: "legal_basis",
  label: "Legal basis",
  labelPlural: "Legal basis catalogue",
  path: "/legal-basis",
  idColumn: "code",
  permissions: { read: "viewer", create: "admin", update: "admin", remove: "admin" },
  removable: false,
  premisesScoped: false,
  searchable: true,
  defaultSort: "code",
  sortable: [{ key: "code", label: "Code" }],
  helpText: "The statutory duties this schema answers to, and which of them carry an express duty to record.",
  columns: [
    { key: "code", label: "Code" },
    { key: "instrument", label: "Instrument" },
    { key: "provision", label: "Provision" },
    { key: "duty", label: "Duty" },
    { key: "is_recording_duty", label: "Recording duty", render: yesNo("is_recording_duty") },
  ],
  filters: [{ param: "is_recording_duty", label: "Recording duty", field: { kind: "boolean" } }],
  fields: [],
};

const schedule2Measures: ResourceConfig = {
  name: "schedule2_measures",
  label: "Schedule 2 measure",
  labelPlural: "Schedule 2 measures",
  path: "/schedule2-measures",
  idColumn: "code",
  permissions: { read: "viewer", create: "admin", update: "admin", remove: "admin" },
  removable: false,
  premisesScoped: false,
  searchable: true,
  defaultSort: "code",
  sortable: [{ key: "code", label: "Code" }],
  helpText: "The Schedule 2 fire safety measures that arrangements, equipment and assessment measures are recorded against.",
  columns: [
    { key: "code", label: "Code" },
    { key: "description", label: "Description" },
  ],
  fields: [],
};

export const GENERIC_RESOURCES: ResourceConfig[] = [
  people,
  safetyRoles,
  arrangements,
  dangerousSubstances,
  checkSchedules,
  emergencyProcedures,
  fireDrills,
  trainingRecords,
  informationRecords,
  cooperationRecords,
  healthSafetyPolicies,
  incidents,
  enforcementNotices,
  enforcementVisits,
];

export const REFERENCE_RESOURCES: ResourceConfig[] = [legalBasis, schedule2Measures];

export function findResourceConfig(name: string): ResourceConfig | undefined {
  return [...GENERIC_RESOURCES, ...REFERENCE_RESOURCES].find((r) => r.name === name);
}
