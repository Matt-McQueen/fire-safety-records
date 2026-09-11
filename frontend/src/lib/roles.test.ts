import { describe, expect, it } from "vitest";
import { atLeast, rank, ROLE_LABELS } from "./roles";
import type { Role } from "../types/api";

describe("rank", () => {
  it("orders the roles from least to most privileged", () => {
    expect(rank("viewer")).toBe(0);
    expect(rank("assessor")).toBe(1);
    expect(rank("manager")).toBe(2);
    expect(rank("admin")).toBe(3);
  });

  it("ranks an absent role below every real one", () => {
    expect(rank(null)).toBe(-1);
    expect(rank(undefined)).toBe(-1);
  });
});

describe("atLeast", () => {
  it("is true for the role itself and anything ranked higher", () => {
    expect(atLeast("manager", "manager")).toBe(true);
    expect(atLeast("admin", "manager")).toBe(true);
  });

  it("is false for anything ranked lower, including an absent role", () => {
    expect(atLeast("viewer", "manager")).toBe(false);
    expect(atLeast(undefined, "viewer")).toBe(false);
  });

  it("mirrors backend/src/auth/middleware.js's rank() ordering exactly", () => {
    // If these two lists ever diverge, a role that the API treats as
    // sufficient could be hidden from — or shown to — the wrong people in
    // the UI, so the order is asserted explicitly rather than just spot
    // checked above.
    const order: Role[] = ["viewer", "assessor", "manager", "admin"];
    for (let i = 0; i < order.length; i += 1) {
      for (let j = 0; j < order.length; j += 1) {
        expect(atLeast(order[i], order[j])).toBe(i >= j);
      }
    }
  });
});

describe("ROLE_LABELS", () => {
  it("has a display label for every role", () => {
    const roles: Role[] = ["viewer", "assessor", "manager", "admin"];
    for (const role of roles) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });
});
