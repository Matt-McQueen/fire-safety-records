// The declarative shape that drives the generic list/create/edit pages
// (src/pages/resource/*). Each entry mirrors one definition in
// backend/src/domain/resources/*.js closely enough that adding a field here
// is mostly a matter of reading the matching zod field over there — the
// server remains the only place business rules are enforced (see the
// backend README: "no client is trusted to decide whether a record is
// allowed"). This config only decides how to *display* a field and *collect*
// a value; the API is what accepts or refuses it.

import type { Role, Row } from "../types/api";

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

export type FieldKind =
  | { kind: "text"; maxLength?: number; placeholder?: string }
  | { kind: "textarea"; maxLength?: number; rows?: number }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "datetime" }
  | { kind: "time" }
  | { kind: "enum"; options: string[]; labels?: Record<string, string> }
  /** A foreign key to another resource's numeric id, shown as a <select>. */
  | { kind: "resource"; resourcePath: string; labelKey: string | ((row: Row) => string) }
  /** A foreign key to another resource's `code` column (legal_basis,
   * schedule2_measures), shown as a <select> of string values. */
  | { kind: "resource-code"; resourcePath: string; labelKey: string | ((row: Row) => string) };

export interface FieldConfig {
  key: string;
  label: string;
  field: FieldKind;
  /** Required when creating. PATCH bodies are always partial (see backend
   * validate.js `partial()`), so required never applies to editing. */
  requiredOnCreate?: boolean;
  /** Fields the backend's `omit()` drops from the update schema — set once
   * at creation and fixed after (e.g. premises_id, person_id). */
  createOnly?: boolean;
  help?: string;
  /** Only meaningful for a "resource" field: extra query params for the
   * options list, e.g. restricting people to those linked to the premises. */
  optionParams?: Record<string, string | number | boolean | undefined>;
}

export interface ColumnConfig {
  key: string;
  label: string;
  render?: (row: Row) => string;
  badge?: (row: Row) => { text: string; tone: BadgeTone } | null;
}

export interface FilterConfig {
  param: string;
  label: string;
  field:
    | { kind: "text" }
    | { kind: "boolean" }
    | { kind: "enum"; options: string[]; labels?: Record<string, string> }
    | { kind: "resource"; resourcePath: string; labelKey: string };
}

export interface ResourcePermissions {
  read: Role;
  create: Role;
  update: Role;
  remove: Role;
}

export interface ResourceConfig {
  /** Matches the backend resource `name`, used as the React Router segment. */
  name: string;
  label: string;
  labelPlural: string;
  /** The API path segment, e.g. "/people". */
  path: string;
  /** Primary key column. Defaults to "id"; the two reference tables use a
   * string "code" instead. */
  idColumn?: string;
  permissions: ResourcePermissions;
  /** Whether records are removable at all — some resources are evidence and
   * only ever amended (e.g. equipment checks refuse DELETE outright). */
  removable: boolean;
  columns: ColumnConfig[];
  fields: FieldConfig[];
  filters?: FilterConfig[];
  searchable?: boolean;
  defaultSort: string;
  sortable: { key: string; label: string }[];
  /** True when every record belongs to one premises via `premises_id`,
   * which is how almost everything in this domain is scoped. */
  premisesScoped: boolean;
  helpText?: string;
}
