import { describe, expect, it } from "vitest";
import { PREMISES_COLUMNS, PREMISES_FIELDS } from "./premises";
import type { Row } from "../types/api";

describe("PREMISES_FIELDS", () => {
  it("declares each field key once", () => {
    const keys = PREMISES_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("requires a name to create a premises, and nothing else", () => {
    const required = PREMISES_FIELDS.filter((field) => field.requiredOnCreate).map((field) => field.key);
    expect(required).toEqual(["name"]);
  });
});

describe("PREMISES_COLUMNS", () => {
  it("declares each column key once", () => {
    const keys = PREMISES_COLUMNS.map((column) => column.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("badges the recording duty as applying or not, from the computed flag alone", () => {
    const column = PREMISES_COLUMNS.find((c) => c.key === "recording_duty_applies")!;
    const applies: Row = { id: 1, recording_duty_applies: true };
    const doesNot: Row = { id: 2, recording_duty_applies: false };

    expect(column.badge?.(applies)).toEqual({ text: "Applies", tone: "blue" });
    expect(column.badge?.(doesNot)).toEqual({ text: "Not triggered", tone: "neutral" });
  });
});
