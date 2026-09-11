// These configs drive the generic list/create/edit pages (src/pages/resource)
// entirely from data, so a typo here — a duplicated path, a defaultSort that
// names a column sortable[] does not list — is a silent bug: the page renders
// something, just not the right thing. These tests catch that class of
// mistake without needing to render a page for every one of the sixteen
// resources.

import { describe, expect, it } from "vitest";
import { findResourceConfig, GENERIC_RESOURCES, REFERENCE_RESOURCES } from "./configs";
import { rank } from "../lib/roles";

const ALL = [...GENERIC_RESOURCES, ...REFERENCE_RESOURCES];

describe("resource configs", () => {
  it("gives every resource a unique name", () => {
    const names = ALL.map((resource) => resource.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every resource a unique API path", () => {
    const paths = ALL.map((resource) => resource.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("has a defaultSort that is one of the columns it declares sortable", () => {
    for (const resource of ALL) {
      const keys = resource.sortable.map((entry) => entry.key);
      expect(keys, `${resource.name} should list defaultSort among sortable`).toContain(
        resource.defaultSort,
      );
    }
  });

  it("does not declare the same field key twice within one resource", () => {
    for (const resource of ALL) {
      const keys = resource.fields.map((field) => field.key);
      expect(new Set(keys).size, `${resource.name} has a duplicated field key`).toBe(keys.length);
    }
  });

  it("does not declare the same column key twice within one resource", () => {
    for (const resource of ALL) {
      const keys = resource.columns.map((column) => column.key);
      expect(new Set(keys).size, `${resource.name} has a duplicated column key`).toBe(keys.length);
    }
  });

  it("never asks for less privilege to remove a record than to update it, or to update it than to read it", () => {
    for (const resource of ALL) {
      const { read, create, update, remove } = resource.permissions;
      expect(rank(read), `${resource.name}: read`).toBeLessThanOrEqual(rank(create));
      expect(rank(create), `${resource.name}: create`).toBeLessThanOrEqual(rank(update));
      expect(rank(update), `${resource.name}: update`).toBeLessThanOrEqual(rank(remove));
    }
  });

  it("only marks a resource unremovable when the read-only reference tables say so", () => {
    for (const resource of ALL) {
      if (!resource.removable) {
        expect(REFERENCE_RESOURCES).toContain(resource);
      }
    }
  });

  it("gives a resource-code field's options a path among the reference resources", () => {
    const referencePaths = new Set(REFERENCE_RESOURCES.map((resource) => resource.path));
    for (const resource of ALL) {
      for (const field of resource.fields) {
        if (field.field.kind === "resource-code") {
          expect(referencePaths, `${resource.name}.${field.key}`).toContain(field.field.resourcePath);
        }
      }
    }
  });
});

describe("findResourceConfig", () => {
  it("finds every generic and reference resource by its name", () => {
    for (const resource of ALL) {
      expect(findResourceConfig(resource.name)).toBe(resource);
    }
  });

  it("returns undefined for a name no resource uses", () => {
    expect(findResourceConfig("not_a_real_resource")).toBeUndefined();
  });
});
