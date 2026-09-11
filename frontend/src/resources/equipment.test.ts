import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_CHECK_FIELDS,
  EQUIPMENT_COLUMNS,
  EQUIPMENT_FIELDS,
  ESCAPE_ROUTE_CHECK_FIELDS,
  ESCAPE_ROUTE_COLUMNS,
  ESCAPE_ROUTE_FIELDS,
  OUTCOME_LABELS,
  OUTCOMES,
} from "./equipment";
import type { Row } from "../types/api";

for (const [name, fields] of Object.entries({
  EQUIPMENT_FIELDS,
  EQUIPMENT_CHECK_FIELDS,
  ESCAPE_ROUTE_FIELDS,
  ESCAPE_ROUTE_CHECK_FIELDS,
})) {
  it(`${name} declares each field key once`, () => {
    const keys = fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
}

it("OUTCOME_LABELS has a label for every outcome", () => {
  for (const outcome of OUTCOMES) {
    expect(OUTCOME_LABELS[outcome]).toBeTruthy();
  }
});

describe("EQUIPMENT_COLUMNS status badge", () => {
  const column = EQUIPMENT_COLUMNS.find((c) => c.key === "in_service")!;

  it("shows removed equipment as removed regardless of anything else", () => {
    const row: Row = { in_service: false, has_unresolved_defect: true, check_overdue: true };
    expect(column.badge?.(row)).toEqual({ text: "Removed", tone: "neutral" });
  });

  it("prioritises an unresolved defect over an overdue check", () => {
    const row: Row = { in_service: true, has_unresolved_defect: true, check_overdue: true };
    expect(column.badge?.(row)).toEqual({ text: "Defect outstanding", tone: "red" });
  });

  it("reports an overdue check when there is no defect", () => {
    const row: Row = { in_service: true, has_unresolved_defect: false, check_overdue: true };
    expect(column.badge?.(row)).toEqual({ text: "Check overdue", tone: "amber" });
  });

  it("reports in service when nothing is wrong", () => {
    const row: Row = { in_service: true, has_unresolved_defect: false, check_overdue: false };
    expect(column.badge?.(row)).toEqual({ text: "In service", tone: "green" });
  });
});

describe("ESCAPE_ROUTE_COLUMNS status badge", () => {
  const column = ESCAPE_ROUTE_COLUMNS.find((c) => c.key === "in_service")!;

  it("mirrors the equipment status badge's precedence for routes", () => {
    expect(column.badge?.({ in_service: false })).toEqual({ text: "Out of service", tone: "neutral" });
    expect(
      column.badge?.({ in_service: true, has_unresolved_obstruction: true, check_overdue: true }),
    ).toEqual({ text: "Obstruction outstanding", tone: "red" });
    expect(
      column.badge?.({ in_service: true, has_unresolved_obstruction: false, check_overdue: true }),
    ).toEqual({ text: "Check overdue", tone: "amber" });
    expect(
      column.badge?.({ in_service: true, has_unresolved_obstruction: false, check_overdue: false }),
    ).toEqual({ text: "In service", tone: "green" });
  });
});
