import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_TYPE_LABELS,
  ASSESSMENT_TYPES,
  FINDING_FIELDS,
  FRA_COLUMNS,
  FRA_CREATE_FIELDS,
  FRA_CURRENT_FIELDS,
  FRA_DRAFT_EDIT_FIELDS,
  MEASURE_FIELDS,
  PERSON_AT_RISK_FIELDS,
} from "./fra";
import type { Row } from "../types/api";

for (const [name, fields] of Object.entries({
  FRA_CREATE_FIELDS,
  FRA_CURRENT_FIELDS,
  FINDING_FIELDS,
  MEASURE_FIELDS,
  PERSON_AT_RISK_FIELDS,
})) {
  it(`${name} declares each field key once`, () => {
    const keys = fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
}

it("ASSESSMENT_TYPE_LABELS has a label for every assessment type", () => {
  for (const type of ASSESSMENT_TYPES) {
    expect(ASSESSMENT_TYPE_LABELS[type]).toBeTruthy();
  }
});

describe("FRA_DRAFT_EDIT_FIELDS", () => {
  it("is FRA_CREATE_FIELDS with premises_id dropped, since a draft cannot be moved to another premises", () => {
    const keys = FRA_DRAFT_EDIT_FIELDS.map((field) => field.key);
    expect(keys).not.toContain("premises_id");
    expect(keys.length).toBe(FRA_CREATE_FIELDS.length - 1);
  });

  it("makes every field editable rather than create-only", () => {
    for (const field of FRA_DRAFT_EDIT_FIELDS) {
      expect(field.createOnly).toBe(false);
    }
  });

  it("does not mutate FRA_CREATE_FIELDS itself", () => {
    const premisesField = FRA_CREATE_FIELDS.find((f) => f.key === "premises_id");
    expect(premisesField?.createOnly).not.toBe(false);
  });
});

describe("FRA_COLUMNS status badge", () => {
  const column = FRA_COLUMNS.find((c) => c.key === "status")!;

  it("flags a current assessment whose review is overdue", () => {
    const row: Row = { status: "current", review_overdue: true };
    expect(column.badge?.(row)).toEqual({ text: "Current — review overdue", tone: "amber" });
  });

  it("shows a current assessment as current when its review is not overdue", () => {
    const row: Row = { status: "current", review_overdue: false };
    expect(column.badge?.(row)).toEqual({ text: "Current", tone: "green" });
  });

  it("shows a draft as a draft", () => {
    expect(column.badge?.({ status: "draft" })).toEqual({ text: "Draft", tone: "blue" });
  });

  it("shows anything else as superseded", () => {
    expect(column.badge?.({ status: "superseded" })).toEqual({ text: "Superseded", tone: "neutral" });
  });

  it("renders the assessment_type column using the known label, falling back to the raw value", () => {
    const typeColumn = FRA_COLUMNS.find((c) => c.key === "assessment_type")!;
    expect(typeColumn.render?.({ assessment_type: "review" })).toBe("Review");
    expect(typeColumn.render?.({ assessment_type: "something_new" })).toBe("something_new");
  });
});
