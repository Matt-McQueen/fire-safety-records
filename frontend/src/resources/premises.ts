import type { ColumnConfig, FieldConfig } from "./types";
import type { Row } from "../types/api";

const ENFORCING_AUTHORITIES = ["Scottish Fire and Rescue Service", "Health and Safety Executive"];

export const PREMISES_FIELDS: FieldConfig[] = [
  { key: "name", label: "Name", field: { kind: "text", maxLength: 200 }, requiredOnCreate: true },
  { key: "address_line1", label: "Address line 1", field: { kind: "text", maxLength: 200 } },
  { key: "address_line2", label: "Address line 2", field: { kind: "text", maxLength: 200 } },
  { key: "town", label: "Town", field: { kind: "text", maxLength: 100 } },
  { key: "postcode", label: "Postcode", field: { kind: "text", maxLength: 10 } },
  { key: "duty_holder_name", label: "Duty holder name", field: { kind: "text", maxLength: 200 } },
  { key: "duty_holder_role", label: "Duty holder role", field: { kind: "text", maxLength: 200 } },
  { key: "employee_count", label: "Employee count", field: { kind: "number", min: 0 } },
  { key: "requires_licence", label: "Requires a licence or registration", field: { kind: "boolean" } },
  {
    key: "licence_details",
    label: "Licence details",
    field: { kind: "textarea" },
    help: "Required when the premises requires a licence: which licence or registration, since that is one of the three triggers for the duty to record.",
  },
  {
    key: "enforcing_authority",
    label: "Enforcing authority",
    field: { kind: "enum", options: ENFORCING_AUTHORITIES },
  },
  { key: "is_multi_occupancy", label: "Multi-occupancy", field: { kind: "boolean" } },
  { key: "notes", label: "Notes", field: { kind: "textarea" } },
];

export const PREMISES_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Name" },
  { key: "town", label: "Town" },
  { key: "postcode", label: "Postcode" },
  { key: "employee_count", label: "Employees" },
  {
    key: "recording_duty_applies",
    label: "Duty to record",
    badge: (row: Row) =>
      row.recording_duty_applies ? { text: "Applies", tone: "blue" } : { text: "Not triggered", tone: "neutral" },
  },
];
