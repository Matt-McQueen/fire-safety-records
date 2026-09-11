import type { ColumnConfig, FieldConfig } from "./types";
import type { Row } from "../types/api";

export const ASSESSMENT_TYPES = ["initial", "review", "revision_after_change"];
export const ASSESSMENT_TYPE_LABELS: Record<string, string> = {
  initial: "Initial",
  review: "Review",
  revision_after_change: "Revision after change",
};

export const FRA_CREATE_FIELDS: FieldConfig[] = [
  {
    key: "premises_id",
    label: "Premises",
    field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
    requiredOnCreate: true,
  },
  { key: "reference", label: "Reference", field: { kind: "text", maxLength: 50 } },
  { key: "carried_out_on", label: "Carried out on", field: { kind: "date" }, requiredOnCreate: true },
  {
    key: "carried_out_by_id",
    label: "Carried out by (internal)",
    field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
    help: "Give either an internal person, or an external assessor below.",
  },
  { key: "assessor_external", label: "External assessor", field: { kind: "text", maxLength: 200 } },
  {
    key: "assessor_competence",
    label: "Assessor competence",
    field: { kind: "textarea" },
    help: "What the assessor's competence rests on — required before this can be published, where the premises is under a duty to record.",
  },
  { key: "next_review_due", label: "Next review due", field: { kind: "date" }, help: "Defaults to one year after carried_out_on if left blank." },
  { key: "covers_young_persons", label: "Covers young persons", field: { kind: "boolean" } },
  { key: "covers_dangerous_substances", label: "Covers dangerous substances", field: { kind: "boolean" } },
  { key: "summary", label: "Summary", field: { kind: "textarea", rows: 6 } },
];

/** SSI 2006/456 reg 9: once an assessment is the recorded one, only its
 * review date and narrative summary may still change. */
export const FRA_CURRENT_FIELDS: FieldConfig[] = [
  { key: "next_review_due", label: "Next review due", field: { kind: "date" } },
  { key: "summary", label: "Summary", field: { kind: "textarea", rows: 6 } },
];

export const FRA_DRAFT_EDIT_FIELDS: FieldConfig[] = FRA_CREATE_FIELDS.filter((f) => f.key !== "premises_id").map(
  (f) => ({ ...f, createOnly: false }),
);

export const FRA_COLUMNS: ColumnConfig[] = [
  { key: "premises_name", label: "Premises" },
  { key: "reference", label: "Reference" },
  { key: "assessment_type", label: "Type", render: (r) => ASSESSMENT_TYPE_LABELS[String(r.assessment_type)] ?? String(r.assessment_type) },
  { key: "carried_out_on", label: "Carried out" },
  {
    key: "status",
    label: "Status",
    badge: (row: Row) => {
      if (row.status === "current") return { text: row.review_overdue ? "Current — review overdue" : "Current", tone: row.review_overdue ? "amber" : "green" };
      if (row.status === "draft") return { text: "Draft", tone: "blue" };
      return { text: "Superseded", tone: "neutral" };
    },
  },
];

export const FINDING_FIELDS: FieldConfig[] = [
  { key: "finding", label: "Finding", field: { kind: "textarea" }, requiredOnCreate: true },
  { key: "location", label: "Location", field: { kind: "text", maxLength: 300 } },
  { key: "ignition_source", label: "Ignition source", field: { kind: "text", maxLength: 300 } },
  { key: "fuel_source", label: "Fuel source", field: { kind: "text", maxLength: 300 } },
  { key: "persons_affected", label: "Persons affected", field: { kind: "text", maxLength: 500 } },
  { key: "risk_rating", label: "Risk rating", field: { kind: "enum", options: ["Low", "Medium", "High"] } },
];

export const MEASURE_FIELDS: FieldConfig[] = [
  {
    key: "schedule2_measure_code",
    label: "Schedule 2 measure",
    field: { kind: "resource-code", resourcePath: "/schedule2-measures", labelKey: (r) => `${r.code} — ${String(r.description ?? "")}` },
  },
  { key: "description", label: "Description", field: { kind: "textarea" }, requiredOnCreate: true },
  { key: "status", label: "Status", field: { kind: "enum", options: ["taken", "planned"] }, requiredOnCreate: true },
  {
    key: "responsible_person_id",
    label: "Responsible person",
    field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
  },
  { key: "target_date", label: "Target date", field: { kind: "date" }, help: "Required for a planned measure." },
  { key: "completed_on", label: "Completed on", field: { kind: "date" }, help: "Required for a taken measure." },
];

export const PERSON_AT_RISK_CATEGORIES = [
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

export const PERSON_AT_RISK_FIELDS: FieldConfig[] = [
  {
    key: "person_id",
    label: "Named person",
    field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
    help: "Give either a named person, or a group description below.",
  },
  { key: "group_description", label: "Group description", field: { kind: "text", maxLength: 300 } },
  { key: "category", label: "Category", field: { kind: "enum", options: PERSON_AT_RISK_CATEGORIES } },
  {
    key: "why_at_risk",
    label: "Why at risk",
    field: { kind: "textarea" },
    help: "Required when a category is set — reg 9(1)(b) records why, not just the label.",
  },
  { key: "measures", label: "Measures", field: { kind: "textarea" } },
  { key: "peep_in_place", label: "Personal emergency evacuation plan (PEEP) in place", field: { kind: "boolean" } },
  { key: "peep_reference", label: "PEEP reference", field: { kind: "text", maxLength: 100 }, help: "Required when a PEEP is in place." },
];
