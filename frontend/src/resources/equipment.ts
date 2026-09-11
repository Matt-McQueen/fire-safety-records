import type { ColumnConfig, FieldConfig } from "./types";
import type { Row } from "../types/api";

export const EQUIPMENT_TYPES = [
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

export const OUTCOMES = ["pass", "fail", "pass_with_defects"];
export const OUTCOME_LABELS: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  pass_with_defects: "Pass with defects",
};

export const EQUIPMENT_FIELDS: FieldConfig[] = [
  {
    key: "premises_id",
    label: "Premises",
    field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
    requiredOnCreate: true,
    createOnly: true,
  },
  { key: "equipment_type", label: "Equipment type", field: { kind: "enum", options: EQUIPMENT_TYPES }, requiredOnCreate: true },
  {
    key: "schedule2_measure_code",
    label: "Schedule 2 measure",
    field: { kind: "resource-code", resourcePath: "/schedule2-measures", labelKey: (r) => `${r.code} — ${String(r.description ?? "")}` },
  },
  { key: "identifier", label: "Identifier", field: { kind: "text", maxLength: 100 } },
  { key: "location", label: "Location", field: { kind: "text", maxLength: 300 }, requiredOnCreate: true },
  { key: "make", label: "Make", field: { kind: "text", maxLength: 100 } },
  { key: "model", label: "Model", field: { kind: "text", maxLength: 100 } },
  { key: "serial_number", label: "Serial number", field: { kind: "text", maxLength: 100 } },
  { key: "installed_on", label: "Installed on", field: { kind: "date" } },
  { key: "standard_reference", label: "Standard reference", field: { kind: "text", maxLength: 100 } },
  { key: "in_service", label: "In service", field: { kind: "boolean" } },
  { key: "removed_on", label: "Removed on", field: { kind: "date" }, help: "Required when in_service is unset." },
];

export const EQUIPMENT_COLUMNS: ColumnConfig[] = [
  { key: "equipment_type", label: "Type" },
  { key: "location", label: "Location" },
  { key: "identifier", label: "Identifier" },
  { key: "next_check_due", label: "Next check due" },
  {
    key: "in_service",
    label: "Status",
    badge: (row: Row) => {
      if (!row.in_service) return { text: "Removed", tone: "neutral" };
      if (row.has_unresolved_defect) return { text: "Defect outstanding", tone: "red" };
      if (row.check_overdue) return { text: "Check overdue", tone: "amber" };
      return { text: "In service", tone: "green" };
    },
  },
];

export const EQUIPMENT_CHECK_FIELDS: FieldConfig[] = [
  { key: "check_type", label: "Check type", field: { kind: "text", maxLength: 50 }, requiredOnCreate: true },
  { key: "performed_on", label: "Performed on", field: { kind: "date" }, requiredOnCreate: true },
  {
    key: "performed_by_id",
    label: "Performed by (internal)",
    field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
  },
  { key: "performed_by_external", label: "Performed by (contractor)", field: { kind: "text", maxLength: 200 } },
  { key: "outcome", label: "Outcome", field: { kind: "enum", options: OUTCOMES, labels: OUTCOME_LABELS }, requiredOnCreate: true },
  { key: "defects_found", label: "Defects found", field: { kind: "textarea" }, help: "Required unless the outcome is a pass." },
  { key: "remedial_action", label: "Remedial action", field: { kind: "textarea" } },
  { key: "remedied_on", label: "Remedied on", field: { kind: "date" } },
  { key: "next_due_on", label: "Next due on", field: { kind: "date" }, help: "Computed from the matching check schedule if left blank." },
  { key: "certificate_reference", label: "Certificate reference", field: { kind: "text", maxLength: 200 } },
];

// --- escape routes -----------------------------------------------------

export const ESCAPE_ROUTE_FIELDS: FieldConfig[] = [
  {
    key: "premises_id",
    label: "Premises",
    field: { kind: "resource", resourcePath: "/premises", labelKey: "name" },
    requiredOnCreate: true,
    createOnly: true,
  },
  { key: "name", label: "Name", field: { kind: "text", maxLength: 200 }, requiredOnCreate: true },
  { key: "description", label: "Description", field: { kind: "textarea" } },
  { key: "final_exit", label: "Final exit", field: { kind: "text", maxLength: 300 } },
  { key: "capacity", label: "Capacity (persons)", field: { kind: "number", min: 0 } },
  { key: "travel_distance_m", label: "Travel distance (m)", field: { kind: "number", min: 0, step: 0.1 } },
  { key: "has_emergency_lighting", label: "Has emergency lighting", field: { kind: "boolean" } },
  { key: "signage_notes", label: "Signage notes", field: { kind: "textarea" } },
  { key: "in_service", label: "In service", field: { kind: "boolean" } },
];

export const ESCAPE_ROUTE_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Name" },
  { key: "final_exit", label: "Final exit" },
  { key: "next_check_due", label: "Next check due" },
  {
    key: "in_service",
    label: "Status",
    badge: (row: Row) => {
      if (!row.in_service) return { text: "Out of service", tone: "neutral" };
      if (row.has_unresolved_obstruction) return { text: "Obstruction outstanding", tone: "red" };
      if (row.check_overdue) return { text: "Check overdue", tone: "amber" };
      return { text: "In service", tone: "green" };
    },
  },
];

export const ESCAPE_ROUTE_CHECK_FIELDS: FieldConfig[] = [
  { key: "performed_on", label: "Performed on", field: { kind: "date" }, requiredOnCreate: true },
  {
    key: "performed_by_id",
    label: "Performed by",
    field: { kind: "resource", resourcePath: "/people", labelKey: "full_name" },
  },
  { key: "outcome", label: "Outcome", field: { kind: "enum", options: OUTCOMES, labels: OUTCOME_LABELS }, requiredOnCreate: true },
  { key: "obstructions_found", label: "Obstructions found", field: { kind: "textarea" }, help: "Required unless the outcome is a pass." },
  { key: "remedial_action", label: "Remedial action", field: { kind: "textarea" } },
  { key: "remedied_on", label: "Remedied on", field: { kind: "date" } },
  { key: "next_due_on", label: "Next due on", field: { kind: "date" } },
];
