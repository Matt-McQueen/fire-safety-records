import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "./nav";
import type { Role } from "../../types/api";

const ROLES: Role[] = ["viewer", "assessor", "manager", "admin"];

describe("NAV_SECTIONS", () => {
  it("gives every item a unique route", () => {
    const paths = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.to));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every section a unique title", () => {
    const titles = NAV_SECTIONS.map((section) => section.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("only restricts an item with a role this app actually has", () => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (item.minRole) expect(ROLES).toContain(item.minRole);
      }
    }
  });

  it("has no empty section", () => {
    for (const section of NAV_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it("routes every item to an absolute, app-relative path", () => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        expect(item.to.startsWith("/")).toBe(true);
      }
    }
  });
});
